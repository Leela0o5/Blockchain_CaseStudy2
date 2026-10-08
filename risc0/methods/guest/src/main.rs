#![no_main]

use risc0_zkvm::guest::env;
use serde::{Deserialize, Serialize};

risc0_zkvm::guest::entry!(main);

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Matrix {
    pub rows: usize,
    pub cols: usize,
    pub data: Vec<i32>,
}

impl Matrix {
    pub fn multiply(&self, other: &Matrix) -> Result<Matrix, &'static str> {
        if self.rows == 0 || self.cols == 0 || other.rows == 0 || other.cols == 0 {
            return Err("Matrix dimensions must be non-zero");
        }
        if self.data.len() != self.rows * self.cols {
            return Err("Matrix A data length mismatch");
        }
        if other.data.len() != other.rows * other.cols {
            return Err("Matrix B data length mismatch");
        }
        if self.cols != other.rows {
            return Err("Matrix dimension mismatch for multiplication");
        }

        let mut result_data = vec![0i32; self.rows * other.cols];

        for i in 0..self.rows {
            for k in 0..self.cols {
                let a_val = self.data[i * self.cols + k];
                for j in 0..other.cols {
                    let b_val = other.data[k * other.cols + j];
                    let idx = i * other.cols + j;
                    result_data[idx] = result_data[idx]
                        .checked_add(a_val.checked_mul(b_val).ok_or("Integer overflow")?)
                        .ok_or("Integer overflow")?;
                }
            }
        }

        Ok(Matrix {
            rows: self.rows,
            cols: other.cols,
            data: result_data,
        })
    }
}

fn main() {
    let (matrix_a, matrix_b): (Matrix, Matrix) = env::read();
    let result = matrix_a
        .multiply(&matrix_b)
        .expect("Guest matrix multiplication failed");
    env::commit(&result);
}
