"""Exercise PostgreSQL backup/restore using disposable, synthetic-only databases.

Requires the repository's PostgreSQL 17 container on localhost:55433. In CI,
pass --container with the PostgreSQL service container ID. Never reads app data.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import uuid

ROOT = Path(__file__).resolve().parents[1]


def run(args, *, data=None, env=None):
    return subprocess.run(args, input=data, stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE, check=True, cwd=ROOT, env=env).stdout


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--container")
    args = parser.parse_args()
    container = args.container or run(["docker", "compose", "ps", "-q", "postgres"]).decode().strip()
    if not container or "\n" in container:
        raise RuntimeError("Expected one running PostgreSQL container")
    docker = ["docker", "exec", "-i", container]
    suffix = uuid.uuid4().hex
    source, target = [f"papers_restore_{kind}_{suffix}" for kind in ("source", "target")]
    created = []

    def sql(database, statement):
        return run(docker + ["psql", "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-U", "agentinfra", "-d", database], data=statement.encode()).decode().strip()

    def schema(database):
        dump = run(docker + ["pg_dump", "-U", "agentinfra", "-d", database, "--schema-only", "--no-owner", "--no-privileges"]).decode()
        # PostgreSQL generates random psql restriction tokens for each dump.
        return "\n".join(line for line in dump.splitlines() if not line.startswith(("\\restrict ", "\\unrestrict ")))

    def contents(database):
        tables = json.loads(sql(database, "SELECT json_agg(tablename ORDER BY tablename) FROM pg_tables WHERE schemaname='public';"))
        result = {}
        for table in tables:
            identifier = '"' + table.replace('"', '""') + '"'
            value = sql(database, f"SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text), '[]'::jsonb) FROM {identifier} t;")
            result[table] = {"rows": len(json.loads(value)), "sha256": hashlib.sha256(value.encode()).hexdigest()}
        return result

    try:
        for database in (source, target):
            run(docker + ["createdb", "-U", "agentinfra", database])
            created.append(database)
        env = dict(os.environ, DATABASE_URL=f"postgresql://agentinfra:agentinfra_local@localhost:55433/{source}")
        run(["npx", "--yes", "pnpm@10.32.1", "--filter", "@agentinfra/db", "migrate"], env=env)
        sql(source, (ROOT / "scripts/fixtures/restore.sql").read_text())
        before = contents(source)
        before_schema = schema(source)
        with tempfile.TemporaryDirectory(prefix="papers-restore-check-") as directory:
            archive = Path(directory) / "fixture.dump"
            archive.write_bytes(run(docker + ["pg_dump", "-U", "agentinfra", "-d", source, "--format=custom", "--no-owner", "--no-privileges"]))
            archive.chmod(0o600)
            run(docker + ["pg_restore", "-U", "agentinfra", "-d", target, "--exit-on-error", "--no-owner", "--no-privileges"], data=archive.read_bytes())
        after = contents(target)
        if before != after:
            raise RuntimeError("Restored table contents differ from the source")
        if before_schema != schema(target):
            raise RuntimeError("Restored schema differs from the source")
        # Check restored uniqueness enforcement, not only the stored catalog.
        try:
            sql(target, 'INSERT INTO "Inbox" (id,"organizationId",name,address) VALUES (\'duplicate\',\'restore-org\',\'Duplicate\',\'restore@example.invalid\');')
        except subprocess.CalledProcessError as error:
            if b"duplicate key value violates unique constraint" not in error.stderr:
                raise
        else:
            raise RuntimeError("Restored inbox address uniqueness was not enforced")
        print(json.dumps({"passed": "PostgreSQL custom archive restore", "tables": len(after), "rows": sum(table["rows"] for table in after.values()), "migrations": after["_prisma_migrations"]["rows"], "schemaMatches": True, "contentsMatch": True, "uniquenessEnforced": True}))
    finally:
        for database in reversed(created):
            run(docker + ["dropdb", "-U", "agentinfra", "--if-exists", database])


if __name__ == "__main__":
    main()
