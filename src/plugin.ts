import streamDeck from "@elgato/streamdeck";
import { ApiTrackerAction } from "./actions/api-tracker";

streamDeck.actions.registerAction(new ApiTrackerAction());
streamDeck.connect();
