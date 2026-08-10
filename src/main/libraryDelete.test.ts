/**
 * DELETE-EVERYWHERE for the Library: "once I delete them from the studio, they get
 * deleted from wherever they're sitting in my computer."
 *
 * The gap this pins shut: a saved IMAGE deleted from the Library only lost its list
 * entry — the file itself (and its backup copies) stayed on disk forever, which is
 * exactly the ghost-hunting the user said he never wants to do. Videos already
 * behaved; now the Library does too.
 *
 * The boundary matters as much as the deletion: only files inside the app's own data
 * folder are ever touched. An entry pointing at the user's Desktop is his ORIGINAL,
 * not the studio's copy, and deleting originals is not this feature — it would be the
 * never-delete-user-work rule broken in the name of tidiness.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const dir = mkdtempSync(join(tmpdir(), 'npz-libdel-'))

vi.mock('electron', () => ({
  app: { getPath: () => dir },
  safeStorage: { isEncryptionAvailable: () => false }
}))

const { saveToLibrary, deleteFromLibrary, emptyLibraryTrash, trashLibraryEntry, listLibrary } = await import('./store')

function saveImage(id: string, path: string): void {
  saveToLibrary({
    id,
    kind: 'image',
    data: { title: 't', path, source: 'Scene Studio' },
    savedAt: new Date().toISOString()
  })
}

beforeEach(() => {
  rmSync(join(dir, 'library.json'), { force: true })
  mkdirSync(join(dir, 'images'), { recursive: true })
})

afterEach(() => vi.restoreAllMocks())

describe('deleting a library image deletes the image', () => {
  it('removes the file and reports its relative path for the backup purge', () => {
    const img = join(dir, 'images', 'scene1.jpg')
    writeFileSync(img, 'jpegbytes')
    saveImage('a', img)

    const { entries, removedRels } = deleteFromLibrary('a')
    expect(entries.find((e) => e.id === 'a')).toBeUndefined()
    expect(existsSync(img)).toBe(false)
    expect(removedRels).toEqual(['images/scene1.jpg'])
  })

  it('NEVER touches a file outside the app data folder — that is the user original', () => {
    const outside = mkdtempSync(join(tmpdir(), 'npz-desktop-'))
    const img = join(outside, 'family-photo.jpg')
    writeFileSync(img, 'precious')
    saveImage('b', img)

    const { removedRels } = deleteFromLibrary('b')
    expect(existsSync(img)).toBe(true)
    expect(removedRels).toEqual([])
    rmSync(outside, { recursive: true, force: true })
  })

  it('empty-trash removes every trashed image file, and only the trashed ones', () => {
    const gone = join(dir, 'images', 'gone.jpg')
    const kept = join(dir, 'images', 'kept.jpg')
    writeFileSync(gone, 'x')
    writeFileSync(kept, 'y')
    saveImage('gone', gone)
    saveImage('kept', kept)
    trashLibraryEntry('gone')

    const { entries, removedRels } = emptyLibraryTrash()
    expect(existsSync(gone)).toBe(false)
    expect(existsSync(kept)).toBe(true)
    expect(removedRels).toEqual(['images/gone.jpg'])
    expect(entries.map((e) => e.id)).toEqual(['kept'])
  })

  it('a script or idea entry deletes cleanly with no file side-effects', () => {
    saveToLibrary({
      id: 'idea1',
      kind: 'idea',
      data: { title: 'x', angle: 'y', outline: [], competition: 'low' } as never,
      savedAt: new Date().toISOString()
    })
    const { entries, removedRels } = deleteFromLibrary('idea1')
    expect(removedRels).toEqual([])
    expect(entries.find((e) => e.id === 'idea1')).toBeUndefined()
    expect(listLibrary().length).toBe(entries.length)
  })
})
