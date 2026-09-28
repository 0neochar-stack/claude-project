import { VEHICLE_TUNING } from "./config/vehicleTuning";
import { Game } from "./core/Game";

const status = document.getElementById("boot-status");

try {
  const game = await Game.create(document.body);
  status?.remove();
  game.start();
  if (new URLSearchParams(location.search).has("tune")) {
    const { createTuningPanel } = await import("./ui/TuningPanel"); // separate chunk, only with ?tune
    createTuningPanel(VEHICLE_TUNING);
  }
} catch (error) {
  console.error(error);
  if (status) status.textContent = `Could not start: ${error instanceof Error ? error.message : String(error)}`;
}
