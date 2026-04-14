import { Command } from "commander";

const program = new Command();

program
  .name("poppet")
  .description("Lightweight CLI process manager")
  .version("0.1.0");

program.parse();
