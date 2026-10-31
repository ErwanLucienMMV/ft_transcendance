"""Checks secret generation in fresh temporary fixtures, never srcs/.env.

Run: python3 srcs/tests/deployment-secrets.test.py
"""
import pathlib
import re
import shutil
import stat
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]


class DeploymentSecretsTest(unittest.TestCase):
    def setUp(self):
        self.fixture = tempfile.TemporaryDirectory(prefix="deployment-secrets-")
        self.addCleanup(self.fixture.cleanup)
        self.root = pathlib.Path(self.fixture.name)
        shutil.copy2(ROOT / "init-env.sh", self.root / "init-env.sh")
        shutil.copy2(ROOT / ".env.example", self.root / ".env.example")
        self.env = self.root / ".env"

    def generate(self):
        # Exercise a permissive caller umask; the script must restrict new files.
        result = subprocess.run(["sh", "-c", 'umask 022; sh "$1"', "fixture", str(self.root / "init-env.sh")], check=True, capture_output=True, text=True)
        values = dict(re.findall(r"^(\w+)=(.*)$", self.env.read_text(), re.M))
        for key in ["DATABASE_PASSWORD", "POSTGRES_BACKUP_PASSWORD", "JWT_SECRET", "GF_SECURITY_ADMIN_PASSWORD"]:
            self.assertRegex(values[key], r"^[0-9a-f]{64}$")
            self.assertNotIn(values[key], result.stdout + result.stderr)
        self.assertFalse((self.root / ".env.tmp").exists())
        return values

    def test_new_secrets_are_private_distinct_and_preserved_on_rerun(self):
        values = self.generate()
        self.assertEqual(stat.S_IMODE(self.env.stat().st_mode), 0o600)
        secrets = [values[key] for key in ["DATABASE_PASSWORD", "POSTGRES_BACKUP_PASSWORD", "JWT_SECRET", "GF_SECURITY_ADMIN_PASSWORD"]]
        self.assertEqual(len(set(secrets)), 4)
        before = self.env.read_bytes()
        self.generate()
        self.assertEqual(self.env.read_bytes(), before)
        self.assertEqual(values["GF_SECURITY_ADMIN_USER"], "admin")

    def test_partial_environment_preserves_existing_values_and_final_line(self):
        existing = "DATABASE_USER=existing-user\nGOOGLE_CLIENT_SECRET=keep-this-value\nAPPURL=https://chess.example"
        self.env.write_text(existing)
        self.generate()
        self.assertTrue(self.env.read_text().startswith(existing + "\n"))

    def test_existing_secret_values_are_never_rotated(self):
        content = "\n".join(f"{key}=keep-{key}" for key in ["DATABASE_PASSWORD", "POSTGRES_BACKUP_PASSWORD", "JWT_SECRET", "GF_SECURITY_ADMIN_PASSWORD", "GF_SECURITY_ADMIN_USER"])
        self.env.write_text(content)
        subprocess.run(["sh", str(self.root / "init-env.sh")], check=True, capture_output=True)
        self.assertEqual(self.env.read_text(), content)

    def test_empty_values_use_private_temporary_replacement(self):
        self.env.write_text("DATABASE_PASSWORD=\nAPPURL=https://chess.example\n")
        self.generate()
        self.assertEqual(stat.S_IMODE(self.env.stat().st_mode), 0o600)
        self.assertIn("APPURL=https://chess.example\n", self.env.read_text())

    def test_every_broad_build_context_excludes_nested_environment_files(self):
        # Ask the container builder to apply the real ignore files to synthetic
        # secrets, rather than treating a pattern's presence as proof it works.
        for context in [ROOT, ROOT / "nestJS", ROOT / "angular", ROOT / "forgemail"]:
            with self.subTest(context=context.name):
                fixture = self.root / context.name
                fixture.mkdir()
                shutil.copy2(context / ".dockerignore", fixture / ".dockerignore")
                paths = [".env", ".env.production", "42chess/.env", "42chess/.env.local", "42chess/src/.env.test", "src/.env"]
                for path in paths:
                    target = fixture / path
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_text("SYNTHETIC_SECRET=fixture-only\n")
                (fixture / "source.ts").write_text("// ordinary source must survive\n")
                checks = " && ".join(f"test ! -e /context/{path}" for path in paths)
                (fixture / "Dockerfile").write_text(f"FROM docker.io/library/debian:bookworm\nCOPY . /context\nRUN test -f /context/source.ts && {checks}\n")
                result = subprocess.run(["docker", "build", "-q", str(fixture)], capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_generated_environment_is_not_tracked(self):
        result = subprocess.run(["git", "ls-files", "--", "srcs/.env", "srcs/nestJS/42chess/.env", "srcs/angular/42chess/.env"], cwd=ROOT.parent, check=True, capture_output=True, text=True)
        self.assertEqual(result.stdout, "")


if __name__ == "__main__":
    unittest.main(verbosity=2)
