import path from "node:path";
import { fileURLToPath } from "node:url";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import {
  getMidnightEndpoints,
  resolveMidnightDeployNetwork,
  type MidnightDeployNetwork,
} from "./midnight_network.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Midnight endpoints + artifacts paths for `offramp` CLI.
 *
 * - **undeployed** — [midnight-local-network](https://github.com/bricktowers/midnight-local-network) (indexer v4 paths on localhost).
 * - **preview** / **preprod** — public Midnight (indexer **v3**); fund via https://faucet.preview.midnight.network/ or https://faucet.preprod.midnight.network/
 */
export class OffRampMidnightConfig {
  readonly deployNetwork: MidnightDeployNetwork;
  readonly indexer: string;
  readonly indexerWS: string;
  readonly proofServer: string;
  readonly networkId: MidnightDeployNetwork;
  readonly relayHttpOrigin: string;
  readonly dustAdditionalFeeOverhead: bigint;
  readonly shieldedAdditionalFeeOverhead: bigint;

  readonly offRampArtifactsDir =
    process.env.MIDNIGHT_OFFRAMP_ARTIFACTS_DIR ??
    path.resolve(__dirname, "../../contract/src/managed/offramp");

  readonly privateStateStoreName =
    process.env.MIDNIGHT_PRIVATE_STATE_STORE ?? "offramp-local-private-state";

  constructor() {
    this.deployNetwork = resolveMidnightDeployNetwork();
    const ep = getMidnightEndpoints(this.deployNetwork);
    setNetworkId(ep.networkId);
    this.indexer = ep.indexerHttp;
    this.indexerWS = ep.indexerWs;
    this.proofServer = ep.proofServer;
    this.networkId = ep.networkId;
    this.relayHttpOrigin = ep.relayHttpOrigin;
    this.dustAdditionalFeeOverhead = ep.dustAdditionalFeeOverhead;
    this.shieldedAdditionalFeeOverhead = ep.shieldedAdditionalFeeOverhead;
  }
}

/** @deprecated Use {@link OffRampMidnightConfig} */
export type LocalUndeployedConfig = OffRampMidnightConfig;
