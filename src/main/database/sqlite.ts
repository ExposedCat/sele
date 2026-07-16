import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import Database from 'better-sqlite3'
import { Kysely, SqliteDialect, sql, type ColumnType } from 'kysely'
import type { ProviderChatCwdKind } from '../../shared/provider'

type SqliteBooleanColumn = ColumnType<number, number | boolean | undefined, number | boolean>

export type LocalDatabase = {
  chat: {
    id: string
    pinned: SqliteBooleanColumn
    done: SqliteBooleanColumn
  }
  cwd_metadata: {
    cwd: string
    kind: ProviderChatCwdKind
    project_cwd: string | null
    branch_name: string | null
  }
}

let database: Kysely<LocalDatabase> | null = null
let schemaReady = false

const getDatabasePath = (): string =>
  process.env.SELE_DATABASE_PATH ?? join(app.getPath('userData'), 'sele.sqlite')

const ensureColumn = async (
  db: Kysely<LocalDatabase>,
  table: string,
  columnName: string,
  addColumn: () => Promise<void>
): Promise<void> => {
  const columns = await sql<{ name: string }>`pragma table_info(${sql.raw(table)})`.execute(db)
  if (columns.rows.some((column) => column.name === columnName)) return

  await addColumn()
}

const ensureSchema = async (db: Kysely<LocalDatabase>): Promise<void> => {
  if (schemaReady) return

  await db.schema
    .createTable('chat')
    .ifNotExists()
    .addColumn('id', 'text', (column) => column.primaryKey())
    .addColumn('pinned', 'integer', (column) => column.notNull().defaultTo(0))
    .addColumn('done', 'integer', (column) => column.notNull().defaultTo(0))
    .execute()

  await db.schema
    .createTable('cwd_metadata')
    .ifNotExists()
    .addColumn('cwd', 'text', (column) => column.primaryKey())
    .addColumn('kind', 'text', (column) => column.notNull())
    .addColumn('project_cwd', 'text')
    .addColumn('branch_name', 'text')
    .execute()

  await ensureColumn(db, 'cwd_metadata', 'project_cwd', () =>
    db.schema.alterTable('cwd_metadata').addColumn('project_cwd', 'text').execute()
  )
  await ensureColumn(db, 'cwd_metadata', 'branch_name', () =>
    db.schema.alterTable('cwd_metadata').addColumn('branch_name', 'text').execute()
  )

  schemaReady = true
}

export const getDatabase = async (): Promise<Kysely<LocalDatabase>> => {
  if (!database) {
    const path = getDatabasePath()
    mkdirSync(dirname(path), { recursive: true })

    database = new Kysely<LocalDatabase>({
      dialect: new SqliteDialect({
        database: new Database(path)
      })
    })
  }

  await ensureSchema(database)
  return database
}

export const disposeDatabase = async (): Promise<void> => {
  const db = database
  database = null
  schemaReady = false

  if (db) await db.destroy()
}
