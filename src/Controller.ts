import { Request as ExpressRequest } from 'express';
import { Controller, Get, Request, Response, Route, Security } from 'tsoa';
import { FeatureToggleStatus, IClient } from './client';
import { IProxyConfig } from './config';
import { createContext } from './create-context';
import { Logger } from './logger';

/**
 This is a model description.
 It describes the features response model.
*/
type FeaturesResponse = {
    /**
   The list of features that are enabled with the given context.
  */
    toggles: FeatureToggleStatus[];
};

type CustomValidationError = {
    message: string;
    context: any;
};

@Route('/proxy2')
export class MainController extends Controller {
    private logger: Logger;

    private clientKeys: string[];

    private serverSideTokens: string[];

    private clientKeysHeaderName: string;

    private client: IClient;

    private ready = false;

    constructor(client: IClient, config: IProxyConfig) {
        super();
        this.logger = config.logger;
        this.clientKeys = config.clientKeys;
        this.serverSideTokens = config.serverSideSdkConfig
            ? config.serverSideSdkConfig.tokens
            : [];
        this.clientKeysHeaderName = config.clientKeysHeaderName;
        this.client = client;

        if (client.isReady()) {
            this.setReady();
        }

        this.client.on('ready', () => {
            this.setReady();
        });

        const router = Router();
        this.middleware = router;

        // Routes
        router.get('/health', this.health.bind(this));
        router.get(
            '/',
            openApiService.validPath({
                responses: { 200: featuresResponse },
            }),
            this.getEnabledToggles.bind(this),
        );
        router.post('/', this.lookupToggles.bind(this));
        router.post('/client/metrics', this.registerMetrics.bind(this));
        router.get('/client/features', this.unleashApi.bind(this));
    }

    /**
     * A very long, verbose, wordy, long-winded, tedious, verbacious, tautological,
     * profuse, expansive, enthusiastic, redundant, flowery, eloquent, articulate,
     * loquacious, garrulous, chatty, extended, babbling description.
     * @summary A concise summary.
     */
    @Get('')
    @Response<CustomValidationError>(
        503,
        'The Unleash Proxy  is not ready to accept requests yet.',
    )
    @Response(
        401,
        'Unauthorized; the client key you provided is not valid for this instance.',
    )
    @Security('clientKey', [this.clientKeysHeaderName, ...this.clientKeys])
    public async getToggles(
        @Request() req: ExpressRequest,
    ): Promise<FeaturesResponse | string | void> {
        if (!this.ready) {
            this.setStatus(503);
            return 'Not ready';
        } else {
            const { query } = req;
            query.remoteAddress = query.remoteAddress || req.ip;
            const context = createContext(query);
            const toggles = this.client.getEnabledToggles(context);
            this.setHeader('Cache-control', 'public, max-age=2');
            return { toggles };
        }
    }

    private setReady() {
        this.ready = true;
        this.logger.info(
            'Successfully synchronized with Unleash API. Proxy is now ready to receive traffic.',
        );
    }

    // kept for backward compatibility
    setProxySecrets(clientKeys: string[]): void {
        this.setClientKeys(clientKeys);
    }

    setClientKeys(clientKeys: string[]): void {
        this.clientKeys = clientKeys;
    }

    getEnabledToggles(
        req: Request,
        res: Response<FeaturesResponseSchema>,
    ): void {
        const apiToken = req.header(this.clientKeysHeaderName);

        if (!this.ready) {
            res.status(503).send(NOT_READY);
        } else if (!apiToken || !this.clientKeys.includes(apiToken)) {
            res.sendStatus(401);
        } else {
            const { query } = req;
            query.remoteAddress = query.remoteAddress || req.ip;
            const context = createContext(query);
            const toggles = this.client.getEnabledToggles(context);
            res.set('Cache-control', 'public, max-age=2');
            res.send({ toggles });
        }
    }

    lookupToggles(req: Request, res: Response): void {
        const clientToken = req.header(this.clientKeysHeaderName);

        if (!this.ready) {
            res.status(503).send(NOT_READY);
        } else if (!clientToken || !this.clientKeys.includes(clientToken)) {
            res.sendStatus(401);
        } else {
            const { context, toggles: toggleNames = [] } = req.body;

            const toggles = this.client.getDefinedToggles(toggleNames, context);
            res.send({ toggles });
        }
    }

    health(req: Request, res: Response): void {
        if (!this.ready) {
            res.status(503).send(NOT_READY);
        } else {
            res.send('ok');
        }
    }

    registerMetrics(req: Request, res: Response): void {
        const token = req.header(this.clientKeysHeaderName);
        const validTokens = [...this.clientKeys, ...this.serverSideTokens];

        if (token && validTokens.includes(token)) {
            const data = req.body;
            const { error, value } = clientMetricsSchema.validate(data);
            if (error) {
                this.logger.warn('Invalid metrics posted', error);
                res.status(400).json(error);
                return;
            }
            this.client.registerMetrics(value);
            res.sendStatus(200);
        } else {
            res.sendStatus(401);
        }
    }

    unleashApi(req: Request, res: Response): void {
        const apiToken = req.header(this.clientKeysHeaderName);
        if (!this.ready) {
            res.status(503).send(NOT_READY);
        } else if (apiToken && this.serverSideTokens.includes(apiToken)) {
            const features = this.client.getFeatureToggleDefinitions();
            res.set('Cache-control', 'public, max-age=2');
            res.send({ version: 2, features });
        } else {
            res.sendStatus(401);
        }
    }
}
