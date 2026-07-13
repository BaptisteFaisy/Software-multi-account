import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

/**
 * Le moteur xterm est volontairement isole dans ce module. `main.ts` le charge
 * avec import() uniquement lorsqu'un terminal est effectivement ouvert ou
 * restaure : les utilisateurs du chat ne paient ni son transfert, ni son parse.
 */
export const createTerminalRuntime = () => {
  const terminal = new Terminal({
    cursorBlink: true,
    cursorStyle: "bar",
    fontFamily: "Cascadia Mono, Consolas, monospace",
    fontSize: 13,
    lineHeight: 1.15,
    theme: {
      background: "#000000",
      foreground: "#f4f4f4",
      cursor: "#ffffff",
      selectionBackground: "#3a3a3a",
      black: "#1a1a1a",
      red: "#f06f6c",
      green: "#8fd694",
      yellow: "#ffd166",
      blue: "#78a6d9",
      magenta: "#d29bd9",
      cyan: "#6ec6bd",
      white: "#f4f4f4",
      brightBlack: "#6a6a6a",
      brightRed: "#ff8a82",
      brightGreen: "#a7e9aa",
      brightYellow: "#ffe08a",
      brightBlue: "#94c1f0",
      brightMagenta: "#e7b3ef",
      brightCyan: "#8de1d7",
      brightWhite: "#ffffff",
    },
  });
  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  return { terminal, fitAddon };
};
