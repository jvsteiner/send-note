import { App, PluginSettingTab, Setting, TextComponent, requestUrl } from "obsidian";
import SendNotePlugin from "./main";

export enum ThemeMode {
  "Same as theme",
  Dark,
  Light,
}

export enum TitleSource {
  "Note title",
  "First H1",
  "Frontmatter property",
}

export enum YamlField {
  link,
  updated,
  encrypted,
  unencrypted,
  title,
  expires,
}

export interface SendNoteSettings {
  yamlField: string;
  titleSource: TitleSource;
  removeYaml: boolean;
  clipboard: boolean;
  shareUnencrypted: boolean;
  debug: number;
  pastebinApiKey: string;
  pastebinUsername: string;
  pastebinPassword: string;
  pastebinUserKey: string;
  pastebinPublic: string;
  pastebinExpiry: string;
}

export const DEFAULT_SETTINGS: SendNoteSettings = {
  yamlField: "send",
  titleSource: TitleSource["Note title"],
  removeYaml: false,
  clipboard: true,
  shareUnencrypted: false,
  debug: 0,
  pastebinApiKey: "",
  pastebinUsername: "",
  pastebinPassword: "",
  pastebinUserKey: "",
  pastebinPublic: "1",
  pastebinExpiry: "1D",
};

export class SendNoteSettingsTab extends PluginSettingTab {
  plugin: SendNotePlugin;
  apikeyEl: TextComponent;

  constructor(app: App, plugin: SendNotePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  setUserKey(): void {
    if (
      this.plugin.settings.pastebinApiKey &&
      this.plugin.settings.pastebinUsername &&
      this.plugin.settings.pastebinPassword
    ) {
      getUserKey(
        this.plugin.settings.pastebinApiKey,
        this.plugin.settings.pastebinUsername,
        this.plugin.settings.pastebinPassword
      ).then((key) => {
        this.plugin.settings.pastebinUserKey = key;
        this.plugin.saveSettings();
        console.log("Set user key", key);
      });
    }
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();

    // Pastebin API key
    new Setting(containerEl)
      .setName("Pastebin API key")
      .setDesc("Pastebin API key")
      .addText((inputEl) => {
        inputEl
          .setPlaceholder("Pastebin API key")
          .setValue(this.plugin.settings.pastebinApiKey)
          .onChange(async (value) => {
            this.plugin.settings.pastebinApiKey = value;
            await this.plugin.saveSettings();
            this.setUserKey();
          });
      });

    // Pastebin username
    new Setting(containerEl)
      .setName("Pastebin username")
      .setDesc("Pastebin username")
      .addText((inputEl) => {
        inputEl
          .setPlaceholder("Pastebin username")
          .setValue(this.plugin.settings.pastebinUsername)
          .onChange(async (value) => {
            this.plugin.settings.pastebinUsername = value;
            await this.plugin.saveSettings();
            this.setUserKey();
          });
      });

    // Pastebin password
    new Setting(containerEl)
      .setName("Pastebin password")
      .setDesc("Pastebin password")
      .addText((inputEl) => {
        inputEl
          .setPlaceholder("Pastebin password")
          .setValue(this.plugin.settings.pastebinPassword)
          .onChange(async (value) => {
            this.plugin.settings.pastebinPassword = value;
            await this.plugin.saveSettings();
            this.setUserKey();
          });
      });

    // Pastebin expiry period
    new Setting(containerEl)
      .setName("Pastebin expiry")
      .setDesc("Pastebin expiry period, ie.: N, 1D, 1W, 1M, 1Y")
      .addText((inputEl) => {
        inputEl
          .setPlaceholder("Pastebin expiry period")
          .setValue(this.plugin.settings.pastebinExpiry)
          .onChange(async (value) => {
            this.plugin.settings.pastebinExpiry = value;
            await this.plugin.saveSettings();
          });
      });

    // Pastebin public setting
    new Setting(containerEl)
      .setName("Pastebin public setting")
      .setDesc("Pastebin public: 0 for public, 1 for unlisted, 2 for private. Default is 1")
      .addText((inputEl) => {
        inputEl
          .setPlaceholder("Pastebinpublic setting")
          .setValue(this.plugin.settings.pastebinPublic)
          .onChange(async (value) => {
            this.plugin.settings.pastebinPublic = value;
            await this.plugin.saveSettings();
          });
      });

    // Local YAML field
    new Setting(containerEl)
      .setName("Frontmatter property prefix")
      .setDesc(
        "The frontmatter property for storing the shared link and updated time. A value of `share` will create frontmatter fields of `share_link` and `share_updated`. Use the is de-conflict frontmatter keys if needed."
      )
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.yamlField)
          .setValue(this.plugin.settings.yamlField)
          .onChange(async (value) => {
            this.plugin.settings.yamlField = value || DEFAULT_SETTINGS.yamlField;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl).setName("Upload options").setHeading();

    // Copy to clipboard
    new Setting(containerEl).setName("Copy the link to clipboard after sharing").addToggle((toggle) => {
      toggle.setValue(this.plugin.settings.clipboard).onChange(async (value) => {
        this.plugin.settings.clipboard = value;
        await this.plugin.saveSettings();
        this.display();
      });
    });

    new Setting(containerEl).setName("Note options").setHeading();

    // Strip frontmatter
    new Setting(containerEl)
      .setName("Remove published frontmatter/YAML")
      .setDesc("Remove frontmatter/YAML/properties from the shared note")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.removeYaml).onChange(async (value) => {
          this.plugin.settings.removeYaml = value;
          await this.plugin.saveSettings();
          this.display();
        });
      });

    // Share encrypted by default
    new Setting(containerEl)
      .setName("Share as encrypted by default")
      .setDesc(
        "If you turn this off, you can enable encryption for individual notes by adding a `share_encrypted` checkbox into a note and ticking it."
      )
      .addToggle((toggle) => {
        toggle.setValue(!this.plugin.settings.shareUnencrypted).onChange(async (value) => {
          this.plugin.settings.shareUnencrypted = !value;
          await this.plugin.saveSettings();
          this.display();
        });
      })
      .then((setting) => addDocs(setting, "https://docs.note.sx/notes/encryption"));
  }
}

function addDocs(setting: Setting, url: string) {
  setting.descEl.createEl("br");
  setting.descEl.createEl("a", {
    text: "View the documentation",
    href: url,
  });
}

async function getUserKey(apiKey: string, username: string, password: string): Promise<string> {
  const url = "https://pastebin.com/api/api_login.php";
  const params = new URLSearchParams();
  params.append("api_dev_key", apiKey);
  params.append("api_user_name", username);
  params.append("api_user_password", password);

  const response = await requestUrl({
    url: url,
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  // await fetch(url, {
  //   method: "POST",
  //   headers: { "Content-Type": "application/x-www-form-urlencoded" },
  //   body: params.toString(),
  // });
  if (response.status === 200) {
    return response.text;
  } else {
    throw new Error("Failed to get user key");
  }
}
