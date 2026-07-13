import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import Database from 'better-sqlite3'
import { Kysely, SqliteDialect, type ColumnType } from 'kysely'

type SqliteBooleanColumn = ColumnType<number, number | boolean | undefined, number | boolean>

export type LocalDatabase = {
  chat: {
    id: string
    pinned: SqliteBooleanColumn
    done: SqliteBooleanColumn
  }
}

let database: Kysely<LocalDatabase> | null = null
let schemaReady = false

const getDatabasePath = (): string =>
  process.env.SELE_DATABASE_PATH ?? join(app.getPath('userData'), 'sele.sqlite')

const ensureSchema = async (db: Kysely<LocalDatabase>): Promise<void> => {
  if (schemaReady) return

  await db.schema
    .createTable('chat')
    .ifNotExists()
    .addColumn('id', 'text', (column) => column.primaryKey())
    .addColumn('pinned', 'integer', (column) => column.notNull().defaultTo(0))
    .addColumn('done', 'integer', (column) => column.notNull().defaultTo(0))
    .execute()

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
