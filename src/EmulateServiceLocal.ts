/**
 * The `Emulate.Service` provider group served by the dev sidecar (see
 * `alchemy/Local/Sidecar.ts`), so an emulator started for one stack keeps
 * running across user-code reloads.
 */
import type * as RpcServer from "alchemy/Local/RpcServer";
import { EmulateServiceProviderLocal } from "./EmulateService.ts";

export default EmulateServiceProviderLocal() satisfies RpcServer.ProviderLayer;
