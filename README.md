# Share Note

Instantly share / publish a note. Notes are shared in markdown format, and are encrypted by default. This plugin uses Pastebin for storage. When shared, the note is upload to pastebin, and a url is created. Other users who receive the url, can open it in obsidian, and the note will be added to their vault. This allows users a quick and easy way to transport notes from one user to another, as long as both users have this plugin installed.

To send a note, choose `Send Note` from the command palette, or click the `⋮` menu in any note and choose `Copy shared link`

<img width="260" src="https://github.com/alangrainger/obsidian-share/assets/16197738/69b270a7-c064-4915-9c81-698ae5b54b44">

## Usage

Use the `Share Note` command from the Command Palette. You can map it to a hotkey to make things faster.

The first time a file is shared, the plugin will automatically upload all your theme styles. The next time you share a file, it will use the previously uploaded theme files.

If you want to force the theme CSS to update, use the command `Force re-upload of all data for this note`.

---

## Encryption

The content of your note is encrypted by default. What this means is that you can read the note, and the person you send it to can read the note, but nobody else can read the content - not even the hosting server.

> 🛈 **Encryption is optional, and can be turned on/off for individual notes, or for all notes, whatever you prefer.**

## Troubleshooting

See here: [Troubleshooting](https://docs.note.sx/Troubleshooting)
