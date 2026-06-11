import os
from pathlib import Path
from collections import defaultdict

# =========================
# CONFIG
# =========================

# Folders to exclude completely
EXCLUDED_FOLDERS = {
    "node_modules",
    ".git",
    "dist",
    "build",
    "bak_outputs",
    "__pycache__",
    ".next",
    ".venv",
    "venv",
    "target",
    "pkg",
    "wasm",
    "technicals",
    "resources"
    "fonts",
    "target",
    "migrations",
    "logs",
    "beacon_venv"
    "certs",
    "proposals"
    "media",
    "assets",
    "static",   
}

# Files to exclude
# Supports exact filenames
EXCLUDED_FILES = {
    ".DS_Store",
    "package-lock.json",
    "yarn.lock",
    "bhak.py",
    "to.md",
    "index.html",
    "Technicals.md"
}

# File patterns to exclude
# Examples:
#   "*.log"
#   "*.tmp"
#   "*.min.js"
EXCLUDED_PATTERNS = {
    "*.log",
    "*.tmp",
    "*.ttf"
}

# Output folder
OUTPUT_FOLDER = "bak_outputs"

# File separator
FILE_END_MARKER = "\n----------file end----\n\n"


# =========================
# HELPERS
# =========================

def should_skip_dir(dirname: str) -> bool:
    return dirname in EXCLUDED_FOLDERS


def should_skip_file(filepath: Path) -> bool:
    """
    Check if a file should be ignored.
    """

    # Exact filename match
    if filepath.name in EXCLUDED_FILES:
        return True

    # Pattern matching
    for pattern in EXCLUDED_PATTERNS:
        if filepath.match(pattern):
            return True

    return False


def get_extension(filepath: Path) -> str:
    """
    Returns cleaned extension name.

    Examples:
        test.tsx -> tsx
        README.md -> md
        noext -> no_extension
    """
    ext = filepath.suffix.lower().strip(".")
    return ext if ext else "no_extension"


# =========================
# DIRECTORY TREE PRINTING
# =========================

def print_directory_tree(base_dir: Path):
    print("\n========== DIRECTORY STRUCTURE ==========\n")
    print(base_dir.name)

    for root, dirs, files in os.walk(base_dir):

        # Skip excluded folders
        dirs[:] = [d for d in dirs if not should_skip_dir(d)]

        relative_root = Path(root).relative_to(base_dir)
        depth = len(relative_root.parts)

        if str(relative_root) != ".":
            indent = "│   " * (depth - 1)
            print(f"{indent}├── {Path(root).name}/")

        file_indent = "│   " * depth

        for file_name in sorted(files):
            file_path = Path(root) / file_name

            if should_skip_file(file_path):
                continue

            print(f"{file_indent}├── {file_name}")

    print("\n=========================================\n")


# =========================
# FILE COLLECTION
# =========================

def collect_files(base_dir: Path):
    """
    Walk through all files recursively
    and group them by extension.
    """

    grouped_files = defaultdict(list)

    for root, dirs, files in os.walk(base_dir):

        # Skip excluded folders
        dirs[:] = [d for d in dirs if not should_skip_dir(d)]

        for file_name in files:
            file_path = Path(root) / file_name

            # Skip files inside output folder
            if OUTPUT_FOLDER in file_path.parts:
                continue

            # Skip ignored files
            if should_skip_file(file_path):
                continue

            ext = get_extension(file_path)
            grouped_files[ext].append(file_path)

    return grouped_files


# =========================
# OUTPUT WRITING
# =========================

def write_grouped_outputs(base_dir: Path, grouped_files):
    output_dir = base_dir / OUTPUT_FOLDER
    output_dir.mkdir(exist_ok=True)

    for ext, files in grouped_files.items():

        output_file = output_dir / f"combined.{ext}.txt"

        with open(output_file, "w", encoding="utf-8") as outfile:

            for file_path in sorted(files):

                try:
                    relative_path = file_path.relative_to(base_dir)

                    with open(file_path, "r", encoding="utf-8") as infile:
                        content = infile.read()

                    outfile.write(f"{relative_path}\n")
                    outfile.write(content)
                    outfile.write(FILE_END_MARKER)

                except Exception as e:

                    outfile.write(f"{relative_path}\n")
                    outfile.write(f"[ERROR READING FILE: {e}]")
                    outfile.write(FILE_END_MARKER)

        print(f"Created: {output_file}")


# =========================
# MAIN
# =========================

def main():

    base_dir = Path.cwd()

    print(f"\nScanning directory: {base_dir}")

    # Print folder structure
    print_directory_tree(base_dir)

    # Collect and combine files
    grouped_files = collect_files(base_dir)

    if not grouped_files:
        print("No files found.")
        return

    write_grouped_outputs(base_dir, grouped_files)

    print("\nDone.")


if __name__ == "__main__":
    main()