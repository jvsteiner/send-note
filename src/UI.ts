import { App, Modal, Setting } from "obsidian";

/**
 * Represents a confirmation dialog that can be used to confirm an action with the user.
 * The dialog displays a title and body text, and provides "Yes" and "No" buttons for the user to respond.
 * When the user confirms the action, the provided `onConfirm` callback function is executed.
 */
class ConfirmDialog extends Modal {
  app: App;
  onConfirm: () => void;
  title?: string;
  body?: string;

  constructor(app: App, onConfirm: () => void) {
    super(app);
    this.onConfirm = onConfirm;
  }

  onOpen() {
    const { contentEl } = this;

    if (this.title) {
      contentEl.createEl("h2", { text: this.title });
    }
    if (this.body) {
      contentEl.createEl("p", { text: this.body });
    }

    new Setting(contentEl)
      .addButton((btn) =>
        btn
          .setButtonText("🗑️ Yes, delete")
          .setCta()
          .onClick(() => {
            this.close();
            this.onConfirm();
          })
      )
      .addButton((btn) =>
        btn.setButtonText("No, cancel").onClick(() => {
          this.close();
        })
      );
  }
}

/**
 * Represents the UI functionality of the application.
 */
export default class UI {
  app: App;

  constructor(app: App) {
    this.app = app;
  }

  /**
   * Displays a confirmation dialog with the given title and body, and executes the provided onConfirm callback if the user confirms the action.
   *
   * @param title - The title of the confirmation dialog.
   * @param body - The body text of the confirmation dialog.
   * @param onConfirm - The callback function to execute if the user confirms the action.
   * @returns The confirmation dialog instance.
   */
  confirmDialog(title = "", body = "", onConfirm: () => void) {
    const dialog = new ConfirmDialog(this.app, onConfirm);
    dialog.title = title;
    dialog.body = body;
    dialog.open();
    return dialog;
  }
}
