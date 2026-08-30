-- Garment Bundle MES/WIP baseline schema
-- PostgreSQL 15+

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE organizations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code varchar(40) NOT NULL UNIQUE,
    name varchar(120) NOT NULL,
    status varchar(20) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE factories (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id),
    code varchar(40) NOT NULL,
    name varchar(120) NOT NULL,
    timezone varchar(50) NOT NULL DEFAULT 'Asia/Shanghai',
    status varchar(20) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, code)
);

CREATE TABLE workshops (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    factory_id uuid NOT NULL REFERENCES factories(id),
    code varchar(40) NOT NULL,
    name varchar(120) NOT NULL,
    manager_worker_id uuid,
    status varchar(20) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'INACTIVE')),
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (factory_id, code)
);

CREATE INDEX idx_workshops_factory_status
    ON workshops(factory_id, status, created_at DESC);

CREATE TABLE production_lines (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    factory_id uuid NOT NULL REFERENCES factories(id),
    workshop_id uuid NOT NULL REFERENCES workshops(id),
    code varchar(40) NOT NULL,
    name varchar(120) NOT NULL,
    manager_worker_id uuid,
    status varchar(20) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'INACTIVE')),
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workshop_id, code)
);

CREATE INDEX idx_production_lines_factory_workshop_status
    ON production_lines(factory_id, workshop_id, status, created_at DESC);

CREATE TABLE app_users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id),
    username varchar(80) NOT NULL,
    password_hash text,
    display_name varchar(100) NOT NULL,
    mobile varchar(30),
    status varchar(20) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'LOCKED', 'INACTIVE')),
    last_login_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    UNIQUE (organization_id, username)
);

CREATE TABLE roles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id),
    code varchar(50) NOT NULL,
    name varchar(100) NOT NULL,
    permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
    data_scope varchar(20) NOT NULL DEFAULT 'FACTORY'
        CHECK (data_scope IN ('ALL', 'FACTORY', 'WORKSHOP', 'LINE', 'SELF')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, code)
);

CREATE TABLE user_roles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES app_users(id),
    role_id uuid NOT NULL REFERENCES roles(id),
    factory_id uuid REFERENCES factories(id),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_user_roles_factory
    ON user_roles (user_id, role_id, factory_id)
    WHERE factory_id IS NOT NULL;

CREATE UNIQUE INDEX uq_user_roles_organization
    ON user_roles (user_id, role_id)
    WHERE factory_id IS NULL;

CREATE TABLE auth_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES app_users(id),
    refresh_token_hash char(64) NOT NULL UNIQUE,
    device_id varchar(100),
    device_name varchar(100),
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    last_used_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (expires_at > created_at),
    CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE INDEX idx_auth_sessions_user_expiry
    ON auth_sessions (user_id, expires_at);

CREATE TABLE workers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    factory_id uuid NOT NULL REFERENCES factories(id),
    user_id uuid UNIQUE REFERENCES app_users(id),
    worker_no varchar(40) NOT NULL,
    name varchar(80) NOT NULL,
    pin_hash text,
    workshop_id uuid REFERENCES workshops(id),
    production_line_id uuid REFERENCES production_lines(id),
    status varchar(20) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'INACTIVE', 'LEFT')),
    hired_on date,
    left_on date,
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    created_by uuid REFERENCES app_users(id),
    updated_by uuid REFERENCES app_users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    UNIQUE (factory_id, worker_no),
    CHECK (left_on IS NULL OR hired_on IS NULL OR left_on >= hired_on)
);

ALTER TABLE workshops
    ADD CONSTRAINT fk_workshops_manager_worker
    FOREIGN KEY (manager_worker_id) REFERENCES workers(id);

ALTER TABLE production_lines
    ADD CONSTRAINT fk_production_lines_manager_worker
    FOREIGN KEY (manager_worker_id) REFERENCES workers(id);

CREATE TABLE customers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    factory_id uuid NOT NULL REFERENCES factories(id),
    code varchar(40) NOT NULL,
    name varchar(120) NOT NULL,
    status varchar(20) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'INACTIVE')),
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    UNIQUE (factory_id, code)
);

CREATE TABLE styles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    factory_id uuid NOT NULL REFERENCES factories(id),
    customer_id uuid REFERENCES customers(id),
    code varchar(60) NOT NULL,
    customer_style_no varchar(100),
    name varchar(150),
    image_url text,
    version_name varchar(40),
    status varchar(20) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'INACTIVE')),
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    UNIQUE (factory_id, code)
);

CREATE TABLE colors (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    factory_id uuid NOT NULL REFERENCES factories(id),
    code varchar(40) NOT NULL,
    name varchar(120) NOT NULL,
    display_order integer NOT NULL DEFAULT 0,
    status varchar(20) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'INACTIVE')),
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (factory_id, code)
);

CREATE TABLE sizes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    factory_id uuid NOT NULL REFERENCES factories(id),
    code varchar(40) NOT NULL,
    name varchar(120) NOT NULL,
    display_order integer NOT NULL DEFAULT 0,
    status varchar(20) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'INACTIVE')),
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (factory_id, code)
);

CREATE TABLE processes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    factory_id uuid NOT NULL REFERENCES factories(id),
    code varchar(40) NOT NULL,
    name varchar(120) NOT NULL,
    unit varchar(30) NOT NULL DEFAULT 'PIECE',
    default_standard_seconds integer CHECK (default_standard_seconds IS NULL OR default_standard_seconds >= 0),
    default_piece_rate numeric(14,4) NOT NULL DEFAULT 0 CHECK (default_piece_rate >= 0),
    status varchar(20) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'INACTIVE')),
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (factory_id, code)
);

CREATE TABLE worker_skills (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id uuid NOT NULL REFERENCES workers(id),
    process_id uuid NOT NULL REFERENCES processes(id),
    skill_level smallint NOT NULL DEFAULT 1 CHECK (skill_level BETWEEN 1 AND 5),
    effective_from date NOT NULL DEFAULT CURRENT_DATE,
    effective_to date,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (worker_id, process_id, effective_from),
    CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE TABLE route_versions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    factory_id uuid NOT NULL REFERENCES factories(id),
    style_id uuid NOT NULL REFERENCES styles(id),
    version_no integer NOT NULL CHECK (version_no > 0),
    status varchar(20) NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT', 'PUBLISHED', 'RETIRED')),
    effective_from date,
    published_at timestamptz,
    published_by uuid REFERENCES app_users(id),
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    created_by uuid REFERENCES app_users(id),
    updated_by uuid REFERENCES app_users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (style_id, version_no)
);

CREATE INDEX idx_route_versions_factory_status
    ON route_versions(factory_id, status, created_at DESC);

CREATE TABLE route_steps (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    factory_id uuid NOT NULL REFERENCES factories(id),
    route_version_id uuid NOT NULL REFERENCES route_versions(id) ON DELETE CASCADE,
    step_no integer NOT NULL CHECK (step_no > 0),
    process_id uuid NOT NULL REFERENCES processes(id),
    is_required boolean NOT NULL DEFAULT true,
    is_quality_gate boolean NOT NULL DEFAULT false,
    allow_parallel boolean NOT NULL DEFAULT false,
    can_skip boolean NOT NULL DEFAULT false,
    is_final boolean NOT NULL DEFAULT false,
    standard_seconds integer CHECK (standard_seconds IS NULL OR standard_seconds >= 0),
    piece_rate numeric(14,4) CHECK (piece_rate IS NULL OR piece_rate >= 0),
    allowed_workshop_ids uuid[] NOT NULL DEFAULT '{}',
    minimum_skill_level smallint NOT NULL DEFAULT 1 CHECK (minimum_skill_level BETWEEN 1 AND 5),
    prerequisite_step_nos integer[] NOT NULL DEFAULT '{}'
        CHECK (0 < ALL (prerequisite_step_nos)),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (route_version_id, step_no)
);

CREATE TABLE production_orders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    factory_id uuid NOT NULL REFERENCES factories(id),
    order_no varchar(60) NOT NULL,
    customer_id uuid REFERENCES customers(id),
    style_id uuid NOT NULL REFERENCES styles(id),
    status varchar(20) NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT', 'RELEASED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
    planned_start_date date,
    due_date date,
    total_planned_qty integer NOT NULL CHECK (total_planned_qty > 0),
    external_ref varchar(100),
    notes text,
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    created_by uuid REFERENCES app_users(id),
    updated_by uuid REFERENCES app_users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (factory_id, order_no),
    CHECK (due_date IS NULL OR planned_start_date IS NULL OR due_date >= planned_start_date)
);

CREATE TABLE production_order_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    factory_id uuid NOT NULL REFERENCES factories(id),
    order_id uuid NOT NULL REFERENCES production_orders(id) ON DELETE RESTRICT,
    line_no integer NOT NULL CHECK (line_no > 0),
    color_id uuid NOT NULL REFERENCES colors(id),
    size_id uuid NOT NULL REFERENCES sizes(id),
    dye_lot_no varchar(60),
    planned_qty integer NOT NULL CHECK (planned_qty > 0),
    overproduction_limit integer NOT NULL DEFAULT 0 CHECK (overproduction_limit >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (order_id, line_no)
);

CREATE TABLE cutting_beds (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    factory_id uuid NOT NULL REFERENCES factories(id),
    order_id uuid NOT NULL REFERENCES production_orders(id),
    bed_no varchar(40) NOT NULL,
    cut_date date NOT NULL,
    ply_count integer CHECK (ply_count IS NULL OR ply_count > 0),
    dye_lot_no varchar(60),
    status varchar(20) NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT', 'CUTTING', 'CUT', 'RELEASED', 'CANCELLED')),
    supervisor_worker_id uuid REFERENCES workers(id),
    notes text,
    created_by uuid REFERENCES app_users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (factory_id, bed_no)
);

CREATE TABLE bundles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    factory_id uuid NOT NULL REFERENCES factories(id),
    order_id uuid NOT NULL REFERENCES production_orders(id),
    order_item_id uuid NOT NULL REFERENCES production_order_items(id),
    cutting_bed_id uuid NOT NULL REFERENCES cutting_beds(id),
    route_version_id uuid NOT NULL REFERENCES route_versions(id),
    bundle_no varchar(80) NOT NULL,
    bundle_seq integer NOT NULL CHECK (bundle_seq > 0),
    short_code varchar(12) NOT NULL,
    qr_token_hash char(64) NOT NULL,
    qr_revoked_at timestamptz,
    planned_qty integer NOT NULL CHECK (planned_qty > 0),
    effective_qty integer NOT NULL CHECK (effective_qty >= 0),
    completed_qty integer NOT NULL DEFAULT 0 CHECK (completed_qty >= 0),
    status varchar(20) NOT NULL DEFAULT 'CREATED'
        CHECK (status IN ('CREATED', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'CANCELLED', 'SPLIT', 'MERGED')),
    current_step_no integer,
    current_workshop_id uuid REFERENCES workshops(id),
    current_line_id uuid REFERENCES production_lines(id),
    blocked_reason text,
    printed_count integer NOT NULL DEFAULT 0 CHECK (printed_count >= 0),
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    created_by uuid REFERENCES app_users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (factory_id, bundle_no),
    UNIQUE (factory_id, short_code),
    UNIQUE (qr_token_hash),
    UNIQUE (cutting_bed_id, bundle_seq),
    CHECK (completed_qty <= effective_qty),
    CHECK ((status = 'BLOCKED' AND blocked_reason IS NOT NULL) OR status <> 'BLOCKED')
);

CREATE TABLE bundle_route_steps (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    factory_id uuid NOT NULL REFERENCES factories(id),
    bundle_id uuid NOT NULL REFERENCES bundles(id) ON DELETE RESTRICT,
    source_route_step_id uuid REFERENCES route_steps(id),
    step_no integer NOT NULL CHECK (step_no > 0),
    process_id uuid NOT NULL REFERENCES processes(id),
    process_code_snapshot varchar(40) NOT NULL,
    process_name_snapshot varchar(120) NOT NULL,
    is_required boolean NOT NULL DEFAULT true,
    is_quality_gate boolean NOT NULL DEFAULT false,
    is_rework boolean NOT NULL DEFAULT false,
    rework_of_step_id uuid REFERENCES bundle_route_steps(id),
    standard_seconds integer CHECK (standard_seconds IS NULL OR standard_seconds >= 0),
    piece_rate_snapshot numeric(14,4) NOT NULL DEFAULT 0 CHECK (piece_rate_snapshot >= 0),
    input_qty integer NOT NULL DEFAULT 0 CHECK (input_qty >= 0),
    good_qty integer NOT NULL DEFAULT 0 CHECK (good_qty >= 0),
    defect_qty integer NOT NULL DEFAULT 0 CHECK (defect_qty >= 0),
    missing_qty integer NOT NULL DEFAULT 0 CHECK (missing_qty >= 0),
    status varchar(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'READY', 'STARTED', 'BLOCKED', 'COMPLETED', 'SKIPPED', 'CANCELLED')),
    started_at timestamptz,
    completed_at timestamptz,
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (bundle_id, step_no),
    CHECK (completed_at IS NULL OR started_at IS NULL OR completed_at >= started_at)
);

CREATE TABLE work_reports (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    factory_id uuid NOT NULL REFERENCES factories(id),
    request_id uuid NOT NULL,
    bundle_id uuid NOT NULL REFERENCES bundles(id),
    bundle_route_step_id uuid NOT NULL REFERENCES bundle_route_steps(id),
    worker_id uuid NOT NULL REFERENCES workers(id),
    workshop_id uuid REFERENCES workshops(id),
    production_line_id uuid REFERENCES production_lines(id),
    status varchar(20) NOT NULL DEFAULT 'STARTED'
        CHECK (status IN ('STARTED', 'COMPLETED', 'CANCELLED', 'REVERSED')),
    input_qty integer NOT NULL DEFAULT 0 CHECK (input_qty >= 0),
    good_qty integer NOT NULL DEFAULT 0 CHECK (good_qty >= 0),
    defect_qty integer NOT NULL DEFAULT 0 CHECK (defect_qty >= 0),
    missing_qty integer NOT NULL DEFAULT 0 CHECK (missing_qty >= 0),
    started_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    client_started_at timestamptz,
    client_completed_at timestamptz,
    device_id varchar(100),
    unit_rate_snapshot numeric(14,4) NOT NULL DEFAULT 0 CHECK (unit_rate_snapshot >= 0),
    notes text,
    correction_of_id uuid REFERENCES work_reports(id),
    created_by uuid REFERENCES app_users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (factory_id, request_id),
    CHECK (completed_at IS NULL OR completed_at >= started_at),
    CHECK (status <> 'COMPLETED' OR input_qty = good_qty + defect_qty + missing_qty)
);

CREATE UNIQUE INDEX uq_work_reports_active_step
    ON work_reports (bundle_route_step_id)
    WHERE status = 'STARTED';

CREATE TABLE quality_issues (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    factory_id uuid NOT NULL REFERENCES factories(id),
    bundle_id uuid NOT NULL REFERENCES bundles(id),
    bundle_route_step_id uuid REFERENCES bundle_route_steps(id),
    work_report_id uuid REFERENCES work_reports(id),
    discovered_by_worker_id uuid REFERENCES workers(id),
    defect_code varchar(50) NOT NULL,
    defect_name varchar(120) NOT NULL,
    quantity integer NOT NULL CHECK (quantity > 0),
    severity varchar(20) NOT NULL DEFAULT 'MINOR'
        CHECK (severity IN ('MINOR', 'MAJOR', 'CRITICAL')),
    responsible_step_id uuid REFERENCES bundle_route_steps(id),
    responsible_worker_id uuid REFERENCES workers(id),
    status varchar(20) NOT NULL DEFAULT 'OPEN'
        CHECK (status IN ('OPEN', 'IN_REVIEW', 'REWORK', 'RELEASED', 'SCRAPPED', 'CLOSED')),
    attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
    notes text,
    created_by uuid REFERENCES app_users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE quality_issue_actions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    quality_issue_id uuid NOT NULL REFERENCES quality_issues(id) ON DELETE RESTRICT,
    action varchar(20) NOT NULL
        CHECK (action IN ('COMMENT', 'ASSIGN', 'REWORK', 'RELEASE', 'SCRAP', 'CLOSE', 'REOPEN')),
    quantity integer CHECK (quantity IS NULL OR quantity > 0),
    actor_user_id uuid REFERENCES app_users(id),
    actor_worker_id uuid REFERENCES workers(id),
    notes text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE piece_rates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    factory_id uuid NOT NULL REFERENCES factories(id),
    style_id uuid REFERENCES styles(id),
    process_id uuid NOT NULL REFERENCES processes(id),
    unit_rate numeric(14,4) NOT NULL CHECK (unit_rate >= 0),
    effective_from date NOT NULL,
    effective_to date,
    created_by uuid REFERENCES app_users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE TABLE piecework_entries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    factory_id uuid NOT NULL REFERENCES factories(id),
    work_report_id uuid NOT NULL UNIQUE REFERENCES work_reports(id),
    worker_id uuid NOT NULL REFERENCES workers(id),
    process_id uuid NOT NULL REFERENCES processes(id),
    quantity integer NOT NULL CHECK (quantity >= 0),
    unit_rate numeric(14,4) NOT NULL CHECK (unit_rate >= 0),
    amount numeric(14,4) NOT NULL CHECK (amount >= 0),
    status varchar(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'CONFIRMED', 'SETTLED', 'REVERSED')),
    adjustment_of_id uuid REFERENCES piecework_entries(id),
    settlement_ref varchar(100),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (amount = quantity * unit_rate)
);

CREATE TABLE print_jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    factory_id uuid NOT NULL REFERENCES factories(id),
    template_code varchar(60) NOT NULL,
    printer_name varchar(120),
    status varchar(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'PRINTING', 'COMPLETED', 'FAILED', 'CANCELLED')),
    requested_by uuid REFERENCES app_users(id),
    error_message text,
    created_at timestamptz NOT NULL DEFAULT now(),
    started_at timestamptz,
    completed_at timestamptz
);

CREATE TABLE print_job_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    print_job_id uuid NOT NULL REFERENCES print_jobs(id) ON DELETE CASCADE,
    bundle_id uuid NOT NULL REFERENCES bundles(id),
    copies integer NOT NULL DEFAULT 1 CHECK (copies > 0),
    is_reprint boolean NOT NULL DEFAULT false,
    reprint_reason text,
    printed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (NOT is_reprint OR reprint_reason IS NOT NULL)
);

CREATE TABLE bundle_relations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    factory_id uuid NOT NULL REFERENCES factories(id),
    source_bundle_id uuid NOT NULL REFERENCES bundles(id),
    target_bundle_id uuid NOT NULL REFERENCES bundles(id),
    relation_type varchar(20) NOT NULL CHECK (relation_type IN ('SPLIT', 'MERGE')),
    quantity integer NOT NULL CHECK (quantity > 0),
    reason text NOT NULL,
    created_by uuid REFERENCES app_users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (source_bundle_id <> target_bundle_id),
    UNIQUE (source_bundle_id, target_bundle_id, relation_type)
);

CREATE TABLE bundle_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    factory_id uuid NOT NULL REFERENCES factories(id),
    bundle_id uuid NOT NULL REFERENCES bundles(id),
    event_type varchar(40) NOT NULL,
    event_at timestamptz NOT NULL DEFAULT now(),
    actor_user_id uuid REFERENCES app_users(id),
    actor_worker_id uuid REFERENCES workers(id),
    work_report_id uuid REFERENCES work_reports(id),
    payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE audit_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id),
    factory_id uuid REFERENCES factories(id),
    request_id uuid,
    actor_user_id uuid REFERENCES app_users(id),
    action varchar(60) NOT NULL,
    object_type varchar(80) NOT NULL,
    object_id uuid,
    ip_address inet,
    user_agent text,
    before_data jsonb,
    after_data jsonb,
    reason text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE idempotency_records (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    factory_id uuid NOT NULL REFERENCES factories(id),
    request_id uuid NOT NULL,
    scope varchar(100) NOT NULL,
    request_hash char(64) NOT NULL,
    response_status integer,
    response_body jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    UNIQUE (factory_id, scope, request_id),
    CHECK (expires_at > created_at)
);

CREATE INDEX idx_workers_factory_line_status
    ON workers (factory_id, production_line_id, status);

CREATE INDEX idx_orders_factory_status_due
    ON production_orders (factory_id, status, due_date);

CREATE INDEX idx_order_items_order
    ON production_order_items (order_id, line_no);

CREATE INDEX idx_cutting_beds_order
    ON cutting_beds (factory_id, order_id, cut_date);

CREATE INDEX idx_bundles_order_status
    ON bundles (factory_id, order_id, status);

CREATE INDEX idx_bundles_item_status
    ON bundles (order_item_id, status);

CREATE INDEX idx_bundles_current_step
    ON bundles (factory_id, current_step_no, status)
    WHERE status IN ('CREATED', 'IN_PROGRESS', 'BLOCKED');

CREATE INDEX idx_bundle_steps_process_status
    ON bundle_route_steps (factory_id, process_id, status);

CREATE INDEX idx_work_reports_bundle_time
    ON work_reports (bundle_id, started_at DESC);

CREATE INDEX idx_work_reports_worker_completed
    ON work_reports (factory_id, worker_id, completed_at DESC)
    WHERE status = 'COMPLETED';

CREATE INDEX idx_quality_open
    ON quality_issues (factory_id, status, created_at)
    WHERE status NOT IN ('CLOSED', 'SCRAPPED');

CREATE INDEX idx_piecework_worker_status
    ON piecework_entries (factory_id, worker_id, status, created_at);

CREATE INDEX idx_print_items_bundle
    ON print_job_items (bundle_id, created_at DESC);

CREATE INDEX idx_bundle_events_timeline
    ON bundle_events (bundle_id, event_at, id);

CREATE INDEX idx_audit_object
    ON audit_logs (organization_id, object_type, object_id, created_at DESC);

CREATE INDEX idx_idempotency_expiry
    ON idempotency_records (expires_at);

COMMIT;
