/// Path passed on the command line (e.g. double-clicking a .md file associated with Fudebako).
#[tauri::command]
fn initial_file() -> Option<String> {
    std::env::args()
        .skip(1)
        .find(|a| !a.starts_with('-'))
}

/// Reads an image referenced by a Markdown document. `src` is the (URL-decoded) path from the
/// document: relative to the document's folder, `/root-relative` to the open workspace folder
/// (if any), or absolute. Only image files can be read this way.
#[tauri::command]
fn read_image(src: String, doc: Option<String>, root: Option<String>) -> Result<tauri::ipc::Response, String> {
    use std::path::{Path, PathBuf};
    const EXT: [&str; 9] = ["png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "bmp", "ico"];
    let src = src.trim();
    let rel = src.trim_start_matches(['/', '\\']);
    let path: PathBuf = if rel.len() != src.len() && root.is_some() {
        Path::new(&root.unwrap()).join(rel)
    } else if Path::new(src).is_absolute() || rel.len() != src.len() {
        PathBuf::from(src)
    } else {
        let doc = doc.ok_or("the document has not been saved yet")?;
        Path::new(&doc).parent().ok_or("no parent folder")?.join(src)
    };
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    if !EXT.contains(&ext.as_str()) {
        return Err(format!("not an image: {}", path.display()));
    }
    std::fs::read(&path)
        .map(tauri::ipc::Response::new)
        .map_err(|e| format!("{}: {}", path.display(), e))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![initial_file, read_image])
        .run(tauri::generate_context!())
        .expect("error while running Fudebako");
}
