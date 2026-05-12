-- ============================================================
-- EL REFUGIO — Base de Datos Robusta
-- SRS IEEE 830 · Arquitectura MVVM
-- PostgreSQL 15+
-- ============================================================

-- ============================================================
-- EXTENSIONES
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- búsqueda fuzzy en mensajes

-- ============================================================
-- ENUMERACIONES
-- ============================================================

CREATE TYPE user_status      AS ENUM ('active', 'suspended', 'deleted', 'pending_verification');
CREATE TYPE user_role        AS ENUM ('user', 'admin');
CREATE TYPE group_visibility AS ENUM ('private', 'invite_only');
CREATE TYPE member_role      AS ENUM ('owner', 'admin', 'member');
CREATE TYPE message_type     AS ENUM ('text', 'file', 'image', 'system');
CREATE TYPE file_type        AS ENUM ('image', 'document', 'pdf', 'other');
CREATE TYPE log_event        AS ENUM (
    'login_success', 'login_failed', 'logout',
    'account_locked', 'account_suspended', 'account_deleted',
    'group_created', 'group_deleted',
    'member_joined', 'member_removed',
    'message_sent', 'file_uploaded',
    'admin_action', 'invitation_created', 'invitation_used'
);
CREATE TYPE invite_status    AS ENUM ('active', 'expired', 'revoked', 'used');

-- ============================================================
-- TABLA: users
-- RF-01 Registro · RF-02 Login · RF-11 Perfil · RF-12 Admin
-- ============================================================
CREATE TABLE users (
    id                  UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    username            VARCHAR(50)     NOT NULL UNIQUE,
    email               VARCHAR(255)    NOT NULL UNIQUE,
    password_hash       TEXT            NOT NULL,           -- bcrypt cost>=12 (RNF-03)
    display_name        VARCHAR(100),
    avatar_url          TEXT,
    bio                 VARCHAR(300),
    role                user_role       NOT NULL DEFAULT 'user',
    status              user_status     NOT NULL DEFAULT 'pending_verification',
    email_verified      BOOLEAN         NOT NULL DEFAULT FALSE,
    failed_login_count  SMALLINT        NOT NULL DEFAULT 0,
    locked_until        TIMESTAMPTZ,                        -- RF-02 bloqueo 15 min
    last_login_at       TIMESTAMPTZ,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ,                        -- soft delete (privacidad)

    CONSTRAINT chk_email_format CHECK (email ~* '^[^@]+@[^@]+\.[^@]+$'),
    CONSTRAINT chk_username_len CHECK (char_length(username) >= 3)
);

-- Índices para búsquedas frecuentes
CREATE INDEX idx_users_email       ON users(email)       WHERE deleted_at IS NULL;
CREATE INDEX idx_users_username    ON users(username)    WHERE deleted_at IS NULL;
CREATE INDEX idx_users_status      ON users(status)      WHERE deleted_at IS NULL;
CREATE INDEX idx_users_role        ON users(role);

-- ============================================================
-- TABLA: sessions
-- RF-02 JWT / tokens · RF-03 Invalidar token
-- ============================================================
CREATE TABLE sessions (
    id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash      TEXT        NOT NULL UNIQUE,            -- hash del JWT
    ip_address      INET,
    user_agent      TEXT,
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked         BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_token_not_empty CHECK (token_hash <> '')
);

CREATE INDEX idx_sessions_user_id    ON sessions(user_id);
CREATE INDEX idx_sessions_token_hash ON sessions(token_hash) WHERE NOT revoked;
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);

-- ============================================================
-- TABLA: groups
-- RF-04 Crear grupo · RF-05 Gestionar grupo
-- ============================================================
CREATE TABLE groups (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(100)    NOT NULL,
    description     VARCHAR(500),
    visibility      group_visibility NOT NULL DEFAULT 'invite_only',
    owner_id        UUID            NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    avatar_url      TEXT,
    max_members     SMALLINT        NOT NULL DEFAULT 100,   -- RNF-01: hasta 100 simultáneos
    message_count   INTEGER         NOT NULL DEFAULT 0,     -- contador denormalizado
    is_active       BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ,

    CONSTRAINT chk_name_len CHECK (char_length(name) >= 1)
);

CREATE INDEX idx_groups_owner_id  ON groups(owner_id);
CREATE INDEX idx_groups_is_active ON groups(is_active) WHERE deleted_at IS NULL;

-- ============================================================
-- TABLA: group_members
-- RF-05 Miembros · RF-09 Unirse por invitación
-- ============================================================
CREATE TABLE group_members (
    id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_id        UUID        NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role            member_role NOT NULL DEFAULT 'member',
    joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    invited_by      UUID        REFERENCES users(id) ON DELETE SET NULL,
    left_at         TIMESTAMPTZ,                            -- null = activo
    is_muted        BOOLEAN     NOT NULL DEFAULT FALSE,

    UNIQUE (group_id, user_id)
);

CREATE INDEX idx_gm_group_id       ON group_members(group_id) WHERE left_at IS NULL;
CREATE INDEX idx_gm_user_id        ON group_members(user_id)  WHERE left_at IS NULL;
CREATE INDEX idx_gm_role           ON group_members(role);

-- ============================================================
-- TABLA: messages
-- RF-06 Mensajes tiempo real · RF-07 E2E · RF-10 Historial
-- VOLUMEN: principal tabla de carga — particionada por mes
-- ============================================================
CREATE TABLE messages (
    id                  UUID            NOT NULL DEFAULT uuid_generate_v4(),
    group_id            UUID            NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    sender_id           UUID            NOT NULL REFERENCES users(id) ON DELETE SET NULL,
    message_type        message_type    NOT NULL DEFAULT 'text',
    -- Contenido cifrado E2E (RF-07): el servidor solo ve bytes cifrados
    content_encrypted   BYTEA           NOT NULL,
    content_iv          BYTEA           NOT NULL,           -- IV para AES-GCM
    content_hmac        BYTEA           NOT NULL,           -- integridad RNF-05
    -- Metadatos no cifrados para funcionamiento del servidor
    reply_to_id         UUID,                               -- referencia a mensaje padre
    is_edited           BOOLEAN         NOT NULL DEFAULT FALSE,
    edited_at           TIMESTAMPTZ,
    is_deleted          BOOLEAN         NOT NULL DEFAULT FALSE,
    deleted_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    PRIMARY KEY (id, created_at)                            -- clave compuesta para particionado
) PARTITION BY RANGE (created_at);

-- Particiones por trimestre (escalable a mensual en producción)
CREATE TABLE messages_2026_q1 PARTITION OF messages
    FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');
CREATE TABLE messages_2026_q2 PARTITION OF messages
    FOR VALUES FROM ('2026-04-01') TO ('2026-07-01');
CREATE TABLE messages_2026_q3 PARTITION OF messages
    FOR VALUES FROM ('2026-07-01') TO ('2026-10-01');
CREATE TABLE messages_2026_q4 PARTITION OF messages
    FOR VALUES FROM ('2026-10-01') TO ('2027-01-01');
CREATE TABLE messages_2027_q1 PARTITION OF messages
    FOR VALUES FROM ('2027-01-01') TO ('2027-04-01');
-- Template para particiones futuras (crear con cron job)
CREATE TABLE messages_default  PARTITION OF messages DEFAULT;

-- Índices en cada partición (heredados automáticamente en PG15+)
CREATE INDEX idx_messages_group_created ON messages(group_id, created_at DESC);
CREATE INDEX idx_messages_sender        ON messages(sender_id, created_at DESC);
CREATE INDEX idx_messages_reply_to      ON messages(reply_to_id) WHERE reply_to_id IS NOT NULL;

-- ============================================================
-- TABLA: message_read_receipts
-- RF-10 Historial / confirmación de entrega
-- ============================================================
CREATE TABLE message_read_receipts (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    message_id  UUID        NOT NULL,
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    read_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (message_id, user_id)
);

CREATE INDEX idx_mrr_message_id ON message_read_receipts(message_id);
CREATE INDEX idx_mrr_user_id    ON message_read_receipts(user_id);

-- ============================================================
-- TABLA: files
-- RF-08 Compartir archivos (máx. 10 MB)
-- ============================================================
CREATE TABLE files (
    id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_id        UUID        NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    uploader_id     UUID        NOT NULL REFERENCES users(id) ON DELETE SET NULL,
    message_id      UUID,                                   -- mensaje que contiene el archivo
    original_name   VARCHAR(255) NOT NULL,
    storage_key     TEXT        NOT NULL UNIQUE,            -- path en object storage (S3/MinIO)
    mime_type       VARCHAR(100),
    file_type       file_type   NOT NULL DEFAULT 'other',
    size_bytes      INTEGER     NOT NULL,
    is_encrypted    BOOLEAN     NOT NULL DEFAULT TRUE,
    checksum_sha256 TEXT        NOT NULL,                   -- integridad RNF-05
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ,

    CONSTRAINT chk_file_size CHECK (size_bytes <= 10485760)  -- 10 MB (RF-08)
);

CREATE INDEX idx_files_group_id    ON files(group_id)    WHERE deleted_at IS NULL;
CREATE INDEX idx_files_uploader_id ON files(uploader_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_files_message_id  ON files(message_id);

-- ============================================================
-- TABLA: invitations
-- RF-09 Invitaciones con expiración
-- ============================================================
CREATE TABLE invitations (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_id        UUID            NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    created_by      UUID            NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token           TEXT            NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
    status          invite_status   NOT NULL DEFAULT 'active',
    max_uses        SMALLINT,                               -- NULL = ilimitado
    uses_count      SMALLINT        NOT NULL DEFAULT 0,
    expires_at      TIMESTAMPTZ,                            -- NULL = sin expiración
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_uses CHECK (max_uses IS NULL OR uses_count <= max_uses)
);

CREATE INDEX idx_invitations_token    ON invitations(token)    WHERE status = 'active';
CREATE INDEX idx_invitations_group_id ON invitations(group_id) WHERE status = 'active';

-- ============================================================
-- TABLA: activity_logs
-- RNF-06 Logs 90 días · RF-12 Panel admin
-- ============================================================
CREATE TABLE activity_logs (
    id          BIGSERIAL   PRIMARY KEY,
    user_id     UUID        REFERENCES users(id) ON DELETE SET NULL,
    event       log_event   NOT NULL,
    ip_address  INET,
    user_agent  TEXT,
    metadata    JSONB,                                      -- datos extra según el evento
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
) PARTITION BY RANGE (created_at);

-- Particiones para retención de 90 días (RNF-06)
CREATE TABLE activity_logs_2026_q1 PARTITION OF activity_logs
    FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');
CREATE TABLE activity_logs_2026_q2 PARTITION OF activity_logs
    FOR VALUES FROM ('2026-04-01') TO ('2026-07-01');
CREATE TABLE activity_logs_2026_q3 PARTITION OF activity_logs
    FOR VALUES FROM ('2026-07-01') TO ('2026-10-01');
CREATE TABLE activity_logs_2026_q4 PARTITION OF activity_logs
    FOR VALUES FROM ('2026-10-01') TO ('2027-01-01');
CREATE TABLE activity_logs_default  PARTITION OF activity_logs DEFAULT;

CREATE INDEX idx_logs_user_id    ON activity_logs(user_id, created_at DESC);
CREATE INDEX idx_logs_event      ON activity_logs(event,   created_at DESC);
CREATE INDEX idx_logs_ip         ON activity_logs(ip_address);
CREATE INDEX idx_logs_metadata   ON activity_logs USING gin(metadata);  -- búsqueda JSON

-- ============================================================
-- TABLA: encryption_keys
-- RF-07 E2E — almacena SOLO claves públicas (nunca privadas)
-- ============================================================
CREATE TABLE encryption_keys (
    id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    public_key      TEXT        NOT NULL,                   -- ECDH/RSA public key (PEM)
    key_fingerprint TEXT        NOT NULL UNIQUE,            -- SHA-256 del public_key
    algorithm       VARCHAR(30) NOT NULL DEFAULT 'ECDH-P384',
    is_current      BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at      TIMESTAMPTZ
);

CREATE INDEX idx_enc_keys_user_id ON encryption_keys(user_id) WHERE is_current = TRUE;

-- ============================================================
-- TABLA: group_encryption_keys
-- RF-07 Claves simétricas de grupo cifradas por receptor
-- ============================================================
CREATE TABLE group_encryption_keys (
    id                  UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_id            UUID        NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    recipient_id        UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    encrypted_key       BYTEA       NOT NULL,               -- AES-256 key cifrada con RSA/ECDH pública
    key_version         SMALLINT    NOT NULL DEFAULT 1,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (group_id, recipient_id, key_version)
);

CREATE INDEX idx_gek_group_recipient ON group_encryption_keys(group_id, recipient_id);

-- ============================================================
-- VISTAS — capa MODEL en MVVM
-- Estas vistas son la "fuente de verdad" que consumen los
-- ViewModels del backend; nunca se expone SQL directo al frontend.
-- ============================================================

-- Vista: usuarios activos con info pública
CREATE OR REPLACE VIEW v_active_users AS
SELECT
    id,
    username,
    display_name,
    avatar_url,
    bio,
    role,
    last_login_at,
    created_at
FROM users
WHERE status = 'active' AND deleted_at IS NULL;

-- Vista: grupos activos con conteo de miembros
CREATE OR REPLACE VIEW v_active_groups AS
SELECT
    g.id,
    g.name,
    g.description,
    g.visibility,
    g.owner_id,
    u.username   AS owner_username,
    g.avatar_url,
    g.max_members,
    g.message_count,
    COUNT(gm.id) AS current_member_count,
    g.created_at
FROM groups g
JOIN users u ON u.id = g.owner_id
LEFT JOIN group_members gm ON gm.group_id = g.id AND gm.left_at IS NULL
WHERE g.is_active = TRUE AND g.deleted_at IS NULL
GROUP BY g.id, u.username;

-- Vista: resumen de invitaciones válidas
CREATE OR REPLACE VIEW v_valid_invitations AS
SELECT
    i.id,
    i.group_id,
    g.name AS group_name,
    i.token,
    i.max_uses,
    i.uses_count,
    i.expires_at,
    i.created_by,
    u.username AS created_by_username
FROM invitations i
JOIN groups g ON g.id = i.group_id
JOIN users  u ON u.id = i.created_by
WHERE i.status = 'active'
  AND (i.expires_at IS NULL OR i.expires_at > NOW())
  AND (i.max_uses   IS NULL OR i.uses_count < i.max_uses);

-- ============================================================
-- FUNCIONES Y TRIGGERS
-- ============================================================

-- Actualiza updated_at automáticamente
CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_groups_updated_at
    BEFORE UPDATE ON groups
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- Bloquea login tras 5 intentos fallidos (RF-02)
CREATE OR REPLACE FUNCTION fn_check_login_attempts()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.failed_login_count >= 5 AND OLD.failed_login_count < 5 THEN
        NEW.locked_until = NOW() + INTERVAL '15 minutes';
        INSERT INTO activity_logs (user_id, event, metadata)
        VALUES (NEW.id, 'account_locked', jsonb_build_object('locked_until', NEW.locked_until));
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_users_login_lock
    BEFORE UPDATE OF failed_login_count ON users
    FOR EACH ROW EXECUTE FUNCTION fn_check_login_attempts();

-- Incrementa message_count en groups (RF-06)
CREATE OR REPLACE FUNCTION fn_increment_group_message_count()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    UPDATE groups SET message_count = message_count + 1
    WHERE id = NEW.group_id;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_messages_count
    AFTER INSERT ON messages
    FOR EACH ROW EXECUTE FUNCTION fn_increment_group_message_count();

-- Expira automáticamente invitaciones vencidas
CREATE OR REPLACE FUNCTION fn_expire_invitations()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    UPDATE invitations
    SET status = 'expired'
    WHERE status = 'active'
      AND expires_at IS NOT NULL
      AND expires_at <= NOW();
END;
$$;
-- Ejecutar con pg_cron: SELECT cron.schedule('expire-invites', '*/15 * * * *', 'SELECT fn_expire_invitations()');

-- ============================================================
-- POLÍTICA DE RETENCIÓN (RNF-06: 90 días de logs)
-- ============================================================
CREATE OR REPLACE FUNCTION fn_purge_old_logs()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    DELETE FROM activity_logs WHERE created_at < NOW() - INTERVAL '90 days';
END;
$$;
-- Programar diariamente con pg_cron

-- ============================================================
-- ROW LEVEL SECURITY (RLS) — Seguridad por fila
-- Asegura que usuarios solo lean sus propios datos (RNF-03/04)
-- ============================================================
ALTER TABLE users            ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_members    ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages         ENABLE ROW LEVEL SECURITY;
ALTER TABLE files            ENABLE ROW LEVEL SECURITY;

-- Política: usuarios solo ven sus propias sesiones
CREATE POLICY pol_sessions_owner ON sessions
    USING (user_id = current_setting('app.current_user_id')::UUID);

-- Política: solo miembros activos del grupo ven mensajes
CREATE POLICY pol_messages_members ON messages
    USING (
        group_id IN (
            SELECT group_id FROM group_members
            WHERE user_id = current_setting('app.current_user_id')::UUID
              AND left_at IS NULL
        )
    );

-- ============================================================
-- DATOS SEMILLA — Usuario administrador inicial
-- ============================================================
INSERT INTO users (username, email, password_hash, role, status, email_verified)
VALUES (
    'sysadmin',
    'admin@elrefugio.app',
    -- Hash de ejemplo: en producción generar con bcrypt cost=12
    '$2b$12$PLACEHOLDER_REPLACE_IN_PRODUCTION_SETUP_BCRYPT_HASH',
    'admin',
    'active',
    TRUE
);

-- ============================================================
-- COMENTARIOS DE DOCUMENTACIÓN (RNF-10)
-- ============================================================
COMMENT ON TABLE users                  IS 'RF-01,RF-02,RF-11,RF-12 — Usuarios del sistema con hashing bcrypt';
COMMENT ON TABLE sessions               IS 'RF-02,RF-03 — Tokens de sesión JWT invalidables';
COMMENT ON TABLE groups                 IS 'RF-04,RF-05 — Grupos de chat privados';
COMMENT ON TABLE group_members          IS 'RF-05,RF-09 — Membresía y roles dentro de grupos';
COMMENT ON TABLE messages               IS 'RF-06,RF-07,RF-10 — Mensajes E2E particionados por fecha';
COMMENT ON TABLE message_read_receipts  IS 'RF-10 — Confirmaciones de lectura/entrega';
COMMENT ON TABLE files                  IS 'RF-08 — Archivos compartidos, máx 10 MB';
COMMENT ON TABLE invitations            IS 'RF-09 — Invitaciones únicas con TTL configurable';
COMMENT ON TABLE activity_logs          IS 'RNF-06 — Logs de auditoría, retención 90 días';
COMMENT ON TABLE encryption_keys        IS 'RF-07 — Claves públicas para cifrado E2E';
COMMENT ON TABLE group_encryption_keys  IS 'RF-07 — Claves simétricas de grupo cifradas por destinatario';
