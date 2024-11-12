# Send Note

Instantly share / publish a note using pastebin as the medium of exchange. Notes are shared in markdown format, and are encrypted by default. This plugin uses Pastebin for storage. When shared, the note is upload to pastebin, and a url is created. Other users who receive the url, can open it in obsidian, and the note will be added to their vault. This allows users a quick and easy way to transport notes from one user to another, as long as both users have this plugin installed.

To send a note, choose `Send Note` from the command palette.

## Usage

Use the `Send Note` command from the Command Palette. You can map it to a hotkey to make things faster.

The yaml frontmatter will be updated to provide access to the share url for you to send to other users. You can also delete the note from the Pastebin backend by clicking the `Delete Note` button in the frontmatter.

---

## Encryption

The content of your note is encrypted by default. What this means is that you can read the note, and the person you send it to can read the note, but nobody else can read the content - not even the hosting server.

> 🛈 **Encryption is optional, and can be turned on/off for individual notes, or for all notes, whatever you prefer.**

## Troubleshooting

See here: [Troubleshooting](https://docs.note.sx/Troubleshooting)

## Acknowledgements

This plugin is based on the [share-note](https://github.com/alangrainger/share-note) plugin by [@alangrainger](https://github.com/alangrainger/). Ok, "based" is a bit of a stretch, I did used a all of the code from that plugin, and I deleted more stuff than I added. This plugin serves a very different purpose, but the UI he created was just perfect, so I used it as a starting point.

## License

MIT License

## TODO

1. I might want to delete previous copies automatically, when you reshare a note. Currently, it will just create a new note, and the old note will still be available, although the url gets replaced in the frontmatter.
2. Add another storage backend, maybe AWS S3, or something else. I'm open to suggestions.
