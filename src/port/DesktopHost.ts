export type DesktopCommand =
    | "new"
    | "open"
    | "open-book"
    | "open-folder"
    | "save"
    | "save-as"
    | "save-book"
    | "export"
    | "focus"
    | "page-setup"
    | "shortcuts";

export interface DesktopHost {
    onCommand(handler: (command: DesktopCommand) => void): () => void;
    onBeforeClose(handler: () => void): () => void;
    ready(): Promise<void>;
    confirmClose(): Promise<void>;
    showPrivacy(): Promise<void>;
}
