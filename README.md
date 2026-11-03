# Zomi Catholic Community Directory

The directory now saves to a local SQLite database so you can add, edit, and delete groups, leaders, households, and family members.

## Run

```bash
npm install
npm start
```

Then open http://localhost:3000

Anyone can **view** the directory. Only an admin can **add, edit, or delete**.

- Click **Admin login**
- Username: `admin`
- Password: `zomi`
- Change with `DIRECTORY_ADMIN_USER` and `DIRECTORY_ADMIN_PASSWORD`
- Existing names, phones, and addresses from the old HTML page are imported on first start

## Data

- Database file: `data/directory.db`
- Uploaded leader photos: `uploads/`
- Original HTML backup: `seed-source.html`

To re-import from the old page (this replaces current database records):

```bash
npm run seed -- --force
```
