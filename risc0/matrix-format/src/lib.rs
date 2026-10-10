#![no_std]

extern crate alloc;

use alloc::vec::Vec;
use core::fmt;

pub const INPUT_TAG: &[u8; 13] = b"RZMM_INPUT_V1";
pub const JOURNAL_TAG: &[u8; 15] = b"RZMM_JOURNAL_V1";
pub const GUEST_INPUT_HEADER_LEN: usize = 68;
pub const MATRIX_INPUT_PREFIX_LEN: usize = INPUT_TAG.len() + 8;
pub const JOURNAL_HEADER_LEN: usize = JOURNAL_TAG.len() + 32 + 32 + 8;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Matrix {
    pub rows: u32,
    pub cols: u32,
    pub data: Vec<i32>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Journal {
    pub job_id: [u8; 32],
    pub input_commitment: [u8; 32],
    pub result: Matrix,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FormatError {
    InvalidTag,
    InvalidDimensions,
    InvalidLength,
    LengthOverflow,
    JobIdMismatch,
    CommitmentMismatch,
}

impl fmt::Display for FormatError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::InvalidTag => "invalid format tag",
            Self::InvalidDimensions => "invalid matrix dimensions",
            Self::InvalidLength => "invalid encoded length",
            Self::LengthOverflow => "encoded length overflow",
            Self::JobIdMismatch => "journal job ID mismatch",
            Self::CommitmentMismatch => "journal input commitment mismatch",
        })
    }
}

pub fn encode_matrix_inputs(a: &Matrix, b: &Matrix) -> Result<Vec<u8>, FormatError> {
    validate_matrix(a)?;
    validate_matrix(b)?;
    if a.cols != b.rows {
        return Err(FormatError::InvalidDimensions);
    }

    let value_count = a
        .data
        .len()
        .checked_add(b.data.len())
        .ok_or(FormatError::LengthOverflow)?;
    let capacity = INPUT_TAG
        .len()
        .checked_add(16)
        .ok_or(FormatError::LengthOverflow)?
        .checked_add(
            value_count
                .checked_mul(4)
                .ok_or(FormatError::LengthOverflow)?,
        )
        .ok_or(FormatError::LengthOverflow)?;
    let mut encoded = Vec::with_capacity(capacity);
    encoded.extend_from_slice(INPUT_TAG);
    encoded.extend_from_slice(&a.rows.to_be_bytes());
    encoded.extend_from_slice(&a.cols.to_be_bytes());
    for element in &a.data {
        encoded.extend_from_slice(&element.to_be_bytes());
    }
    encoded.extend_from_slice(&b.rows.to_be_bytes());
    encoded.extend_from_slice(&b.cols.to_be_bytes());
    for element in &b.data {
        encoded.extend_from_slice(&element.to_be_bytes());
    }
    Ok(encoded)
}

pub fn decode_matrix_inputs(encoded: &[u8]) -> Result<(Matrix, Matrix), FormatError> {
    if encoded.len() < MATRIX_INPUT_PREFIX_LEN {
        return Err(FormatError::InvalidLength);
    }
    if &encoded[..INPUT_TAG.len()] != INPUT_TAG {
        return Err(FormatError::InvalidTag);
    }
    let mut cursor = INPUT_TAG.len();
    let a = read_matrix(encoded, &mut cursor)?;
    let b = read_matrix(encoded, &mut cursor)?;
    if a.cols != b.rows {
        return Err(FormatError::InvalidDimensions);
    }
    if cursor != encoded.len() {
        return Err(FormatError::InvalidLength);
    }
    Ok((a, b))
}

pub fn encode_guest_input(
    job_id: [u8; 32],
    input_commitment: [u8; 32],
    canonical_matrix_inputs: &[u8],
) -> Result<Vec<u8>, FormatError> {
    let input_len =
        u32::try_from(canonical_matrix_inputs.len()).map_err(|_| FormatError::LengthOverflow)?;
    let capacity = GUEST_INPUT_HEADER_LEN
        .checked_add(canonical_matrix_inputs.len())
        .ok_or(FormatError::LengthOverflow)?;
    let mut encoded = Vec::with_capacity(capacity);
    encoded.extend_from_slice(&job_id);
    encoded.extend_from_slice(&input_commitment);
    encoded.extend_from_slice(&input_len.to_be_bytes());
    encoded.extend_from_slice(canonical_matrix_inputs);
    Ok(encoded)
}

pub fn encode_journal(
    job_id: [u8; 32],
    input_commitment: [u8; 32],
    result: &Matrix,
) -> Result<Vec<u8>, FormatError> {
    validate_matrix(result)?;
    let capacity = JOURNAL_HEADER_LEN
        .checked_add(
            result
                .data
                .len()
                .checked_mul(4)
                .ok_or(FormatError::LengthOverflow)?,
        )
        .ok_or(FormatError::LengthOverflow)?;
    let mut encoded = Vec::with_capacity(capacity);
    encoded.extend_from_slice(JOURNAL_TAG);
    encoded.extend_from_slice(&job_id);
    encoded.extend_from_slice(&input_commitment);
    append_matrix(&mut encoded, result);
    Ok(encoded)
}

pub fn decode_journal(encoded: &[u8]) -> Result<Journal, FormatError> {
    if encoded.len() < JOURNAL_HEADER_LEN {
        return Err(FormatError::InvalidLength);
    }
    if &encoded[..JOURNAL_TAG.len()] != JOURNAL_TAG {
        return Err(FormatError::InvalidTag);
    }

    let job_id_start = JOURNAL_TAG.len();
    let commitment_start = job_id_start + 32;
    let matrix_start = commitment_start + 32;
    let job_id = encoded[job_id_start..commitment_start]
        .try_into()
        .map_err(|_| FormatError::InvalidLength)?;
    let input_commitment = encoded[commitment_start..matrix_start]
        .try_into()
        .map_err(|_| FormatError::InvalidLength)?;

    let mut cursor = matrix_start;
    let result = read_matrix(encoded, &mut cursor)?;
    if cursor != encoded.len() {
        return Err(FormatError::InvalidLength);
    }
    Ok(Journal {
        job_id,
        input_commitment,
        result,
    })
}

pub fn validate_binding(
    journal: &Journal,
    expected_job_id: [u8; 32],
    expected_commitment: [u8; 32],
) -> Result<(), FormatError> {
    if journal.job_id != expected_job_id {
        return Err(FormatError::JobIdMismatch);
    }
    if journal.input_commitment != expected_commitment {
        return Err(FormatError::CommitmentMismatch);
    }
    Ok(())
}

fn validate_matrix(matrix: &Matrix) -> Result<(), FormatError> {
    if matrix.rows == 0
        || matrix.cols == 0
        || checked_element_count(matrix.rows, matrix.cols)? != matrix.data.len()
    {
        return Err(FormatError::InvalidDimensions);
    }
    Ok(())
}

fn checked_element_count(rows: u32, cols: u32) -> Result<usize, FormatError> {
    (rows as usize)
        .checked_mul(cols as usize)
        .ok_or(FormatError::LengthOverflow)
}

fn append_matrix(encoded: &mut Vec<u8>, matrix: &Matrix) {
    encoded.extend_from_slice(&matrix.rows.to_be_bytes());
    encoded.extend_from_slice(&matrix.cols.to_be_bytes());
    for element in &matrix.data {
        encoded.extend_from_slice(&element.to_be_bytes());
    }
}

fn read_matrix(encoded: &[u8], cursor: &mut usize) -> Result<Matrix, FormatError> {
    let rows = read_u32(encoded, *cursor)?;
    let cols = read_u32(encoded, *cursor + 4)?;
    *cursor = cursor.checked_add(8).ok_or(FormatError::LengthOverflow)?;
    if rows == 0 || cols == 0 {
        return Err(FormatError::InvalidDimensions);
    }
    let count = checked_element_count(rows, cols)?;
    let end = cursor
        .checked_add(count.checked_mul(4).ok_or(FormatError::LengthOverflow)?)
        .ok_or(FormatError::LengthOverflow)?;
    if end > encoded.len() {
        return Err(FormatError::InvalidLength);
    }

    let mut data = Vec::with_capacity(count);
    while *cursor < end {
        data.push(i32::from_be_bytes(
            encoded[*cursor..*cursor + 4]
                .try_into()
                .map_err(|_| FormatError::InvalidLength)?,
        ));
        *cursor += 4;
    }
    Ok(Matrix { rows, cols, data })
}

fn read_u32(encoded: &[u8], offset: usize) -> Result<u32, FormatError> {
    let end = offset.checked_add(4).ok_or(FormatError::LengthOverflow)?;
    let bytes = encoded.get(offset..end).ok_or(FormatError::InvalidLength)?;
    Ok(u32::from_be_bytes(
        bytes.try_into().map_err(|_| FormatError::InvalidLength)?,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloc::vec;

    fn sample_matrices() -> (Matrix, Matrix) {
        (
            Matrix {
                rows: 2,
                cols: 3,
                data: vec![1, -2, 3, 4, 5, 6],
            },
            Matrix {
                rows: 3,
                cols: 2,
                data: vec![7, 8, 9, 1, 2, 3],
            },
        )
    }

    #[test]
    fn canonical_input_has_fixed_big_endian_encoding_and_round_trips() {
        let (a, b) = sample_matrices();
        let encoded = encode_matrix_inputs(&a, &b).unwrap();
        assert_eq!(&encoded[..INPUT_TAG.len()], INPUT_TAG);
        assert_eq!(
            &encoded[INPUT_TAG.len()..INPUT_TAG.len() + 8],
            &[0, 0, 0, 2, 0, 0, 0, 3]
        );
        assert_eq!(
            &encoded[INPUT_TAG.len() + 12..INPUT_TAG.len() + 16],
            &(-2i32).to_be_bytes()
        );
        assert_eq!(
            &encoded[encoded.len() - 32..encoded.len() - 28],
            &[0, 0, 0, 3]
        );
        assert_eq!(encoded, encode_matrix_inputs(&a, &b).unwrap());
        assert_eq!(decode_matrix_inputs(&encoded).unwrap(), (a, b));
    }

    #[test]
    fn input_commitment_preimage_changes_with_matrix_values() {
        let (a, b) = sample_matrices();
        let original = encode_matrix_inputs(&a, &b).unwrap();
        let mut changed_b = b;
        changed_b.data[0] += 1;
        assert_ne!(original, encode_matrix_inputs(&a, &changed_b).unwrap());
    }

    #[test]
    fn journal_round_trips_and_binds_job_and_commitment() {
        let result = Matrix {
            rows: 2,
            cols: 2,
            data: vec![31, 19, 85, 55],
        };
        let job_id = [0u8; 31].into_iter().chain([7]).collect::<Vec<_>>();
        let job_id: [u8; 32] = job_id.try_into().unwrap();
        let commitment = [9u8; 32];
        let encoded = encode_journal(job_id, commitment, &result).unwrap();
        let journal = decode_journal(&encoded).unwrap();
        assert_eq!(journal.result, result);
        assert_eq!(validate_binding(&journal, job_id, commitment), Ok(()));
        assert_eq!(
            validate_binding(&journal, [0u8; 32], commitment),
            Err(FormatError::JobIdMismatch)
        );
        assert_eq!(
            validate_binding(&journal, job_id, [8u8; 32]),
            Err(FormatError::CommitmentMismatch)
        );
    }

    #[test]
    fn invalid_dimensions_and_tampered_journal_are_rejected() {
        let invalid = Matrix {
            rows: 0,
            cols: 2,
            data: Vec::new(),
        };
        let valid = Matrix {
            rows: 2,
            cols: 1,
            data: vec![1, 2],
        };
        assert_eq!(
            encode_matrix_inputs(&invalid, &valid),
            Err(FormatError::InvalidDimensions)
        );

        let result = Matrix {
            rows: 1,
            cols: 1,
            data: vec![42],
        };
        let mut journal = encode_journal([1u8; 32], [2u8; 32], &result).unwrap();
        journal.pop();
        assert_eq!(decode_journal(&journal), Err(FormatError::InvalidLength));
    }
}
