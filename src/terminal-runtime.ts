import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { terminalThemeFor, type ThemeMode } from "./theme";

/**
 * Le moteur xterm est volontairement isole dans ce module. `main.ts` le charge
 * avec import() uniquement lorsqu'un terminal est effectivement ouvert ou
 * restaure : les utilisateurs du chat ne paient ni son transfert, ni son parse.
 */
export const createTerminalRuntime = (theme: ThemeMode = "dark") => {
  const terminal = new Terminal({
    cursorBlink: true,
    cursorStyle: "bar",
    fontFamily: "Cascadia Mono, Consolas, monospace",
    fontSize: 13,
    lineHeight: 1.15,
    theme: terminalThemeFor(theme),
  });
  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  return { terminal, fitAddon };
};
