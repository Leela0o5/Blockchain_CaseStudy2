import assert from 'node:assert/strict'
import test from 'node:test'
import { encodeCanonicalMatrixInputs, parseIntegerMatrix } from './matrix-input.ts'

test('parses rectangular matrices and accepts signed int32 boundaries', () => {
  assert.deepEqual(parseIntegerMatrix('-2147483648, 2147483647\n0, -1', 'A'), {
    rows: 2,
    columns: 2,
    values: [-2147483648, 2147483647, 0, -1],
  })
})

test('rejects empty, non-integer, and non-rectangular matrices', () => {
  assert.throws(() => parseIntegerMatrix(' \n ', 'A'), /cannot be empty/)
  assert.throws(() => parseIntegerMatrix('1,2\n3', 'A'), /must be rectangular/)
  assert.throws(() => parseIntegerMatrix('1,nope', 'A'), /integers only/)
})

test('rejects values outside the signed int32 range', () => {
  assert.throws(() => parseIntegerMatrix('2147483648', 'A'), /signed 32-bit/)
  assert.throws(() => parseIntegerMatrix('-2147483649', 'A'), /signed 32-bit/)
})

test('encodes the canonical tag, dimensions, and signed big-endian elements', () => {
  const encoded = encodeCanonicalMatrixInputs(
    '1, -2\n2147483647, -2147483648',
    '5\n-6',
  )
  const view = new DataView(encoded.buffer, encoded.byteOffset, encoded.byteLength)
  const tag = new TextDecoder().decode(encoded.slice(0, 13))

  assert.equal(tag, 'RZMM_INPUT_V1')
  assert.equal(encoded.length, 13 + 8 + 4 * 4 + 8 + 4 * 2)
  assert.equal(view.getUint32(13, false), 2)
  assert.equal(view.getUint32(17, false), 2)
  assert.deepEqual(
    [21, 25, 29, 33].map((offset) => view.getInt32(offset, false)),
    [1, -2, 2147483647, -2147483648],
  )
  assert.equal(view.getUint32(37, false), 2)
  assert.equal(view.getUint32(41, false), 1)
  assert.deepEqual([45, 49].map((offset) => view.getInt32(offset, false)), [5, -6])
})

test('rejects incompatible matrix multiplication dimensions', () => {
  assert.throws(
    () => encodeCanonicalMatrixInputs('1,2', '3,4'),
    /Matrix A columns must equal Matrix B rows/,
  )
})
