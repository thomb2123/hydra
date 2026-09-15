"""Preserve an explicit Steam client path in the bundled UMU zipapp.

UMU 1.3.0 initializes this field as empty even when supplied by its caller.
This mechanical patch is idempotent and leaves all other archive entries intact.
"""
from pathlib import Path
import io
import zipfile

archive = Path(__file__).resolve().parents[1] / "binaries/umu/umu-run"
original = archive.read_bytes()
old = b'"STEAM_COMPAT_CLIENT_INSTALL_PATH": "",'
new = b'"STEAM_COMPAT_CLIENT_INSTALL_PATH": os.environ.get("STEAM_COMPAT_CLIENT_INSTALL_PATH", ""),'
with zipfile.ZipFile(io.BytesIO(original)) as source:
    contents = source.read("umu/umu_run.py")
    if new in contents:
        print("UMU Steam path patch already present")
    else:
        if contents.count(old) != 1:
            raise SystemExit("Unexpected UMU source; refusing to patch")
        prefix = original[:min(entry.header_offset for entry in source.infolist())]
        output = io.BytesIO()
        output.write(prefix)
        with zipfile.ZipFile(output, "w") as target:
            for entry in source.infolist():
                data = source.read(entry.filename)
                if entry.filename == "umu/umu_run.py":
                    data = contents.replace(old, new)
                    compile(data, entry.filename, "exec")
                target.writestr(entry, data)
        archive.write_bytes(output.getvalue())
        print("Patched UMU to preserve the supplied Steam client path")
