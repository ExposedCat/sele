import { getDatabase } from './sqlite'

const unknownCwdKey = '__unknown__'

export type ProjectIconRecord = {
  imagePath: string
  updatedAt: number
}

const getCwdKey = (cwd: string | null): string => cwd?.trim() || unknownCwdKey

export const getProjectIcon = async (cwd: string | null): Promise<ProjectIconRecord | null> => {
  const db = await getDatabase()
  const row = await db
    .selectFrom('project_icons')
    .select(['image_path', 'updated_at'])
    .where('cwd_key', '=', getCwdKey(cwd))
    .executeTakeFirst()

  if (!row) return null

  return {
    imagePath: row.image_path,
    updatedAt: row.updated_at
  }
}

export const setProjectIcon = async (
  cwd: string | null,
  imagePath: string
): Promise<ProjectIconRecord> => {
  const db = await getDatabase()
  const cwdKey = getCwdKey(cwd)
  const updatedAt = Date.now()

  await db
    .insertInto('project_icons')
    .values({
      cwd_key: cwdKey,
      image_path: imagePath,
      updated_at: updatedAt
    })
    .onConflict((conflict) =>
      conflict.column('cwd_key').doUpdateSet({
        image_path: imagePath,
        updated_at: updatedAt
      })
    )
    .execute()

  return {
    imagePath,
    updatedAt
  }
}
