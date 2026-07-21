// Minecraft formatting codes mapped to ANSI escape sequences
const ANSI_CODES: Record<string, string> = {
  "0": "[30m",
  "1": "[34m",
  "2": "[32m",
  "3": "[36m",
  "4": "[31m",
  "5": "[35m",
  "6": "[33m",
  "7": "[37m",
  "8": "[90m",
  "9": "[94m",
  a: "[92m",
  b: "[96m",
  c: "[91m",
  d: "[95m",
  e: "[93m",
  f: "[97m",
  // Bedrock's material colours, approximated with the closest ANSI tones
  g: "[33m",
  h: "[97m",
  i: "[37m",
  j: "[90m",
  m: "[31m",
  n: "[33m",
  p: "[93m",
  q: "[32m",
  s: "[96m",
  t: "[34m",
  u: "[95m",
  v: "[33m",
  // Text styling
  l: "[1m",
  o: "[3m",
  r: "[0m"
};

// The severity levels a Logger can emit
enum LogLevel {
  Debug = 0,
  Info = 1,
  Warn = 2,
  Error = 3,
  Silent = 4
}

// Translates section-sign colour codes into ANSI escape sequences
function colorize(input: string): string {
  return input.replace(/§(.)/g, (match, code: string) => {
    return ANSI_CODES[code.toLowerCase()] ?? match;
  });
}

// Strips section-sign colour codes entirely
function decolorize(input: string): string {
  return input.replace(/§./g, "");
}

class Logger {
  // The global severity threshold shared by every logger instance
  public static level: LogLevel = LogLevel.Info;

  // Whether ANSI colours should be emitted to the console
  public static colors = true;

  // The name shown in the log prefix
  public readonly name: string;

  // The colour code applied to the logger name
  public readonly accent: string;

  public constructor(name: string, accent = "§b") {
    this.name = name;
    this.accent = accent;
  }

  // Creates a child logger that shares this logger's accent colour
  public derive(name: string, accent = this.accent): Logger {
    return new Logger(name, accent);
  }

  public debug(...message: Array<unknown>): void {
    this.write(LogLevel.Debug, "§8DEBUG", message);
  }

  public info(...message: Array<unknown>): void {
    this.write(LogLevel.Info, "§aINFO§r ", message);
  }

  public warn(...message: Array<unknown>): void {
    this.write(LogLevel.Warn, "§eWARN§r ", message);
  }

  public error(...message: Array<unknown>): void {
    this.write(LogLevel.Error, "§cERROR", message);
  }

  // Formats and prints a single log line to the console
  private write(level: LogLevel, label: string, message: Array<unknown>): void {
    // Skip the message if it falls below the configured threshold
    if (level < Logger.level) return;

    // Build the timestamp portion of the prefix
    const time = new Date().toLocaleTimeString("en-US", { hour12: false });

    // Assemble the full prefix for the line
    const prefix = `§8[§7${time}§8] §8[${label}§8] [${this.accent}${this.name}§8]§r`;

    // Convert every argument into a printable string
    const body = message
      .map((value) => {
        if (typeof value === "string") return value;
        if (value instanceof Error) return value.stack ?? value.message;

        return typeof value === "object" ? JSON.stringify(value) : String(value);
      })
      .join(" ");

    // Compose the final line and apply or strip the colour codes
    const line = `${prefix} ${body}§r`;

    // Errors and warnings are routed to stderr, everything else to stdout
    const stream = level >= LogLevel.Warn ? process.stderr : process.stdout;

    stream.write(`${Logger.colors ? colorize(line) : decolorize(line)}\n`);
  }
}

export { Logger, LogLevel, colorize, decolorize };
