use std::env;
use std::fs;
use std::path::PathBuf;

#[no_mangle]
pub unsafe extern "C" fn sys_alloc_aligned(bytes: usize, align: usize) -> *mut u8 {
    let layout = std::alloc::Layout::from_size_align(bytes, align).unwrap();
    std::alloc::alloc(layout)
}

fn main() {
    risc0_build::embed_methods();

    let out_dir = env::var_os("OUT_DIR").unwrap();
    let methods_path = PathBuf::from(out_dir).join("methods.rs");
    if methods_path.exists() {
        let content = fs::read_to_string(&methods_path).unwrap();
        let fixed_content = fix_windows_paths(&content);
        fs::write(&methods_path, fixed_content).unwrap();
    }
}

fn fix_windows_paths(content: &str) -> String {
    let mut result = String::new();
    for line in content.lines() {
        if line.contains("_GUEST_PATH: &str = \"") {
            if let Some(start_idx) = line.find(" = \"") {
                let prefix = &line[..start_idx + 4];
                let path_and_rest = &line[start_idx + 4..];
                if let Some(end_quote) = path_and_rest.rfind("\";") {
                    let raw_path = &path_and_rest[..end_quote];
                    let escaped_path = raw_path.replace('\\', "\\\\");
                    result.push_str(prefix);
                    result.push_str(&escaped_path);
                    result.push_str("\";\n");
                    continue;
                }
            }
        }
        result.push_str(line);
        result.push('\n');
    }
    result
}
