export interface IntegerMatrix {
  rows: number
  columns: number
  values: number[]
}

const MATRIX_INPUT_TAG = new TextEncoder().encode('RZMM_INPUT_V1')
const INT32_MIN = -2_147_483_648n
const INT32_MAX = 2_147_483_647n

export function parseIntegerMatrix(text: string, label: string): IntegerMatrix {
  const normalized = text.trim()
  if (!normalized) throw new Error(`${label} matrix cannot be empty.`)

  const rows = normalized.split(/\r?\n/)
  const values: number[] = []
  let columns: number | null = null

  for (const [rowIndex, rowText] of rows.entries()) {
    const entries = rowText.split(',')
    if (entries.some((entry) => !/^[+-]?\d+$/.test(entry.trim()))) {
      throw new Error(`${label} row ${rowIndex + 1} must contain comma-separated integers only.`)
    }
    if (columns !== null && entries.length !== columns) {
      throw new Error(`${label} matrix must be rectangular; row ${rowIndex + 1} has a different number of columns.`)
    }
    columns = entries.length

    for (const entry of entries) {
      const value = BigInt(entry.trim())
      if (value < INT32_MIN || value > INT32_MAX) {
        throw new Error(`${label} matrix entries must fit the signed 32-bit integer range.`)
      }
      values.push(Number(value))
    }
  }

  if (columns === null || columns === 0) {
    throw new Error(`${label} matrix cannot be empty.`)
  }
  if (rows.length > 0xffff_ffff || columns > 0xffff_ffff) {
    throw new Error(`${label} matrix dimensions exceed the canonical format limit.`)
  }

  return { rows: rows.length, columns, values }
}

export function encodeCanonicalMatrixInputs(matrixAText: string, matrixBText: string): Uint8Array {
  const matrixA = parseIntegerMatrix(matrixAText, 'Matrix A')
  const matrixB = parseIntegerMatrix(matrixBText, 'Matrix B')
  if (matrixA.columns !== matrixB.rows) {
    throw new Error('Matrix A columns must equal Matrix B rows.')
  }

  const elementCount = matrixA.values.length + matrixB.values.length
  const byteLength = MATRIX_INPUT_TAG.length + 16 + elementCount * 4
  if (!Number.isSafeInteger(byteLength)) {
    throw new Error('Encoded matrix input is too large.')
  }

  const encoded = new Uint8Array(byteLength)
  encoded.set(MATRIX_INPUT_TAG, 0)
  const view = new DataView(encoded.buffer)
  let offset = MATRIX_INPUT_TAG.length

  const appendMatrix = (matrix: IntegerMatrix) => {
    view.setUint32(offset, matrix.rows, false)
    view.setUint32(offset + 4, matrix.columns, false)
    offset += 8
    for (const value of matrix.values) {
      view.setInt32(offset, value, false)
      offset += 4
    }
  }

  appendMatrix(matrixA)
  appendMatrix(matrixB)
  return encoded
}
