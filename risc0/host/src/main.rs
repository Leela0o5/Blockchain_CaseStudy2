use host::{execute_and_prove, verify_and_extract, Matrix};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let a = Matrix::new(2, 3, vec![1, 2, 3, 4, 5, 6])?;
    let b = Matrix::new(3, 2, vec![7, 8, 9, 1, 2, 3])?;

    println!("Running RISC Zero matrix multiplication...");
    let receipt = execute_and_prove(&a, &b)?;

    println!("Verifying receipt and extracting result...");
    let result = verify_and_extract(&receipt)?;

    println!(
        "Success! Computed matrix result ({}x{}): {:?}",
        result.rows, result.cols, result.data
    );

    Ok(())
}
