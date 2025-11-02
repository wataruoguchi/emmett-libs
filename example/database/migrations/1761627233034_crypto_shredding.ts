import { sql, type Kysely } from "kysely";

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function up(db: Kysely<any>): Promise<void> {
  /**
   * ================================================
   * encryption_keys (PARTITIONED)
   * ================================================
   */
  await db.schema
    .createTable("encryption_keys")
    .ifNotExists()
    .addColumn("key_id", "text", (col) => col.notNull())
    .addColumn("partition", "text", (col) => col.notNull())
    .addColumn("key_material", "bytea", (col) => col.notNull())
    .addColumn("key_version", "integer", (col) => col.notNull().defaultTo(1))
    .addColumn("created_at", "timestamptz(3)", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn("updated_at", "timestamptz(3)", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn("destroyed_at", "timestamptz(3)", (col) => col.defaultTo(null))
    .addColumn("is_active", "boolean", (col) => col.notNull().defaultTo(true))
    .addPrimaryKeyConstraint("pk_encryption_keys", ["key_id", "partition"])
    .modifyEnd(sql` PARTITION BY LIST (partition);`)
    .execute();

  // Indexes on parent (propagated to partitions)
  await sql`CREATE INDEX IF NOT EXISTS idx_encryption_keys_partition ON encryption_keys (partition);`.execute(
    db,
  );
  await sql`CREATE INDEX IF NOT EXISTS idx_encryption_keys_active ON encryption_keys (is_active, destroyed_at);`.execute(
    db,
  );

  // DEFAULT partition
  await sql`CREATE TABLE IF NOT EXISTS encryption_keys_default PARTITION OF encryption_keys DEFAULT;`.execute(
    db,
  );

  /**
   * ================================================
   * encryption_policies (PARTITIONED)
   * ================================================
   */
  await db.schema
    .createTable("encryption_policies")
    .ifNotExists()
    .addColumn("policy_id", "text", (col) => col.notNull())
    .addColumn("stream_type_class", "text", (col) => col.notNull())
    .addColumn("partition", "text", (col) => col.notNull())
    .addColumn("key_scope", "text", (col) => col.notNull().defaultTo("type"))
    .addColumn("encryption_algorithm", "text")
    .addColumn("key_rotation_interval_days", "integer")
    .addColumn("created_at", "timestamptz(3)", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn("updated_at", "timestamptz(3)", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addPrimaryKeyConstraint("pk_encryption_policies", [
      "policy_id",
      "partition",
    ])
    .modifyEnd(sql` PARTITION BY LIST (partition);`)
    .execute();

  await sql`CREATE INDEX IF NOT EXISTS idx_encryption_policies_stream_type ON encryption_policies (stream_type_class, partition);`.execute(
    db,
  );
  await sql`CREATE TABLE IF NOT EXISTS encryption_policies_default PARTITION OF encryption_policies DEFAULT;`.execute(
    db,
  );
}

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function down(db: Kysely<any>): Promise<void> {
  // Drop DEFAULT partitions first, then parents
  await sql`DROP INDEX IF EXISTS idx_encryption_policies_stream_type;`.execute(
    db,
  );
  await sql`DROP TABLE IF EXISTS encryption_policies_default;`.execute(db);
  await sql`DROP TABLE IF EXISTS encryption_policies;`.execute(db);

  await sql`DROP INDEX IF EXISTS idx_encryption_keys_active;`.execute(db);
  await sql`DROP INDEX IF EXISTS idx_encryption_keys_partition;`.execute(db);
  await sql`DROP TABLE IF EXISTS encryption_keys_default;`.execute(db);
  await sql`DROP TABLE IF EXISTS encryption_keys;`.execute(db);
}
