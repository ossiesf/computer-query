// Entry point.
import "./styles.css";
import { App } from "./app";
import { readDevMode } from "./dev/devMode";
import { DevView } from "./dev/devView";
import { detectDevice } from "./device";

const devView = readDevMode() ? new DevView(() => app.openDevTable()) : null;
const app = new App(devView);

app.start(detectDevice());
