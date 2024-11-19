import { App, PluginSettingTab, Setting, TextComponent, requestUrl, setIcon } from "obsidian";
import SendNotePlugin from "./main";
import StatusMessage, { StatusType } from "./StatusMessage";

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
  accessKey: string;
  secretKey: string;
  region: string;
  bucket: string;
  folder: string;
  expiry: string;
  imageUrlPath: string;
  useCustomEndpoint: boolean;
  customEndpoint: string;
  forcePathStyle: boolean;
  useCustomImageUrl: boolean;
  customImageUrl: string;
  bypassCors: boolean;
  queryStringValue: string;
  queryStringKey: string;
}

export const DEFAULT_SETTINGS: SendNoteSettings = {
  yamlField: "send",
  titleSource: TitleSource["Note title"],
  removeYaml: false,
  clipboard: true,
  shareUnencrypted: false,
  debug: 0,
  accessKey: "",
  secretKey: "",
  region: "eu-west-2",
  bucket: "",
  folder: "",
  expiry: "24",
  imageUrlPath: "",
  useCustomEndpoint: false,
  customEndpoint: "",
  forcePathStyle: false,
  useCustomImageUrl: false,
  customImageUrl: "",
  bypassCors: false,
  queryStringValue: "",
  queryStringKey: "",
};

export class SendNoteSettingsTab extends PluginSettingTab {
  plugin: SendNotePlugin;
  apikeyEl: TextComponent;
  status: StatusMessage;

  constructor(app: App, plugin: SendNotePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();

    new Setting(containerEl)
      .setName("AWS Access Key ID")
      .setDesc("AWS access key ID for a user with S3 access.")
      .addText((text) => {
        wrapTextWithPasswordHide(text);
        text
          .setPlaceholder("access key")
          .setValue(this.plugin.settings.accessKey)
          .onChange(async (value) => {
            this.plugin.settings.accessKey = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("AWS Secret Key")
      .setDesc("AWS secret key for that user.")
      .addText((text) => {
        wrapTextWithPasswordHide(text);
        text
          .setPlaceholder("secret key")
          .setValue(this.plugin.settings.secretKey)
          .onChange(async (value) => {
            this.plugin.settings.secretKey = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Region")
      .setDesc("AWS region of the S3 bucket.")
      .addText((text) =>
        text
          .setPlaceholder("aws region")
          .setValue(this.plugin.settings.region)
          .onChange(async (value) => {
            this.plugin.settings.region = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("S3 Bucket")
      .setDesc("S3 bucket name.")
      .addText((text) =>
        text
          .setPlaceholder("bucket name")
          .setValue(this.plugin.settings.bucket)
          .onChange(async (value) => {
            this.plugin.settings.bucket = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Bucket folder")
      .setDesc("Optional folder in s3 bucket. Support the use of ${year}, ${month}, and ${day} variables.")
      .addText((text) =>
        text
          .setPlaceholder("folder")
          .setValue(this.plugin.settings.folder)
          .onChange(async (value) => {
            this.plugin.settings.folder = value.trim();
            await this.plugin.saveSettings();
          })
      );
    new Setting(containerEl)
      .setName("Use custom endpoint")
      .setDesc("Use the custom api endpoint below.")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.useCustomEndpoint).onChange(async (value) => {
          this.plugin.settings.useCustomEndpoint = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Custom S3 Endpoint")
      .setDesc("Optionally set a custom endpoint for any S3 compatible storage provider.")
      .addText((text) =>
        text
          .setPlaceholder("https://s3.myhost.com/")
          .setValue(this.plugin.settings.customEndpoint)
          .onChange(async (value) => {
            value = value.match(/https?:\/\//) // Force to start http(s)://
              ? value
              : "https://" + value;
            value = value.replace(/([^\/])$/, "$1/"); // Force to end with slash
            this.plugin.settings.customEndpoint = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("S3 Path Style URLs")
      .setDesc(
        "Advanced option to force using (legacy) path-style s3 URLs (s3.myhost.com/bucket) instead of the modern AWS standard host-style (bucket.s3.myhost.com)."
      )
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.forcePathStyle).onChange(async (value) => {
          this.plugin.settings.forcePathStyle = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Use custom image URL")
      .setDesc("Use the custom image URL below.")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.useCustomImageUrl).onChange(async (value) => {
          this.plugin.settings.useCustomImageUrl = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Custom Image URL")
      .setDesc("Advanced option to force inserting custom image URLs. This option is helpful if you are using CDN.")
      .addText((text) =>
        text.setValue(this.plugin.settings.customImageUrl).onChange(async (value) => {
          value = value.match(/https?:\/\//) // Force to start http(s)://
            ? value
            : "https://" + value;
          value = value.replace(/([^\/])$/, "$1/"); // Force to end with slash
          this.plugin.settings.customImageUrl = value.trim();
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Bypass local CORS check")
      .setDesc("Bypass local CORS preflight checks - it might work on later versions of Obsidian.")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.bypassCors).onChange(async (value) => {
          this.plugin.settings.bypassCors = value;
          await this.plugin.saveSettings();
        });
      });
    new Setting(containerEl)
      .setName("Query string key")
      .setDesc("Appended to the end of the URL. Optional")
      .addText((text) =>
        text
          .setPlaceholder("Empty means no query string key")
          .setValue(this.plugin.settings.queryStringKey)
          .onChange(async (value) => {
            this.plugin.settings.queryStringKey = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Query string value")
      .setDesc("Appended to the end of the URL. Optional")
      .addText((text) =>
        text
          .setPlaceholder("Empty means no query string value")
          .setValue(this.plugin.settings.queryStringValue)
          .onChange(async (value) => {
            this.plugin.settings.queryStringValue = value;
            await this.plugin.saveSettings();
          })
      );

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

    new Setting(containerEl).setName("Uploads").setHeading();

    // Copy to clipboard
    new Setting(containerEl).setName("Copy the link to clipboard after sharing").addToggle((toggle) => {
      toggle.setValue(this.plugin.settings.clipboard).onChange(async (value) => {
        this.plugin.settings.clipboard = value;
        await this.plugin.saveSettings();
        this.display();
      });
    });

    new Setting(containerEl).setName("Notes").setHeading();

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
      });
    // .then((setting) => addDocs(setting, "https://docs.note.sx/notes/encryption"));
  }
}

function addDocs(setting: Setting, url: string) {
  setting.descEl.createEl("br");
  setting.descEl.createEl("a", {
    text: "View the documentation",
    href: url,
  });
}

const wrapTextWithPasswordHide = (text: TextComponent) => {
  const hider = text.inputEl.insertAdjacentElement("beforebegin", createSpan());
  if (!hider) {
    return;
  }
  setIcon(hider as HTMLElement, "eye-off");

  hider.addEventListener("click", () => {
    const isText = text.inputEl.getAttribute("type") === "text";
    if (isText) {
      setIcon(hider as HTMLElement, "eye-off");
      text.inputEl.setAttribute("type", "password");
    } else {
      setIcon(hider as HTMLElement, "eye");
      text.inputEl.setAttribute("type", "text");
    }
    text.inputEl.focus();
  });
  text.inputEl.setAttribute("type", "password");
  return text;
};
