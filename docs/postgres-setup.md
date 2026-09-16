# Postgres Setup (used for this build)

Confirmed working setup, native install on Linux (Kali):

```bash
sudo apt update && sudo apt install -y postgresql postgresql-contrib postgis postgresql-16-postgis-3
sudo systemctl enable --now postgresql
sudo -u postgres psql
```
Inside `psql`:
```sql
CREATE USER kabonix WITH PASSWORD 'ChangeMe123!';
CREATE DATABASE kabonix_db OWNER kabonix;
GRANT ALL PRIVILEGES ON DATABASE kabonix_db TO kabonix;
\c kabonix_db
CREATE EXTENSION IF NOT EXISTS postgis;
SELECT postgis_version();  -- should print a version, e.g. "3.6 USE_GEOS=1 ..."
```

Connection string used by the API:
```
postgresql://kabonix:ChangeMe123!@localhost:5432/kabonix_db
```
