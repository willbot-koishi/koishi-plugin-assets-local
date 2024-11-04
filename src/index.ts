import { Context, z } from 'koishi'
import {} from '@koishijs/plugin-server'
import LocalAssets from 'koishi-plugin-assets-local'

import { createHmac } from 'node:crypto'
import path from 'node:path'
import url from 'node:url'
import fs, { ReadStream } from 'node:fs'

declare module 'koishi' {
    interface Context {
        assetsAlt: LocalAltAssets
    }
}

const streamToBuffer = async (stream: ReadStream): Promise<Buffer> => {
    const chunks: Buffer[] = []
    for await (const chunk of stream) chunks.push(chunk)
    return Buffer.concat(chunks)
}

const fileExists = async (path: string): Promise<boolean> => fs.promises.access(path)
    .then(() => true)
    .catch(() => false)

class LocalAltAssets extends LocalAssets {
    static name = 'w-assets-local'

    protected pathAlt: string
    protected rootAlt: string
    protected noServerAlt: boolean
    protected baseUrlAlt: string

    constructor(ctx: Context, public config: LocalAltAssets.Config) {
        super(ctx, config)
        this.pathAlt = this['path']
        this.noServerAlt = this['noServer']
        this.baseUrlAlt = this['baseUrl']
        this.rootAlt = path.resolve(ctx.baseDir, config.root)
        ctx.set('assetsAlt', this)
    }

    public async uploadFile(file: Blob | Buffer | string, name: string): Promise<string> {
        const savePath = path.resolve(this.rootAlt, name)
        if (await fileExists(savePath)) throw 409

        const fileBuffer: Buffer
            = file instanceof Blob ? Buffer.from(await file.arrayBuffer())
            : typeof file === 'string' ? Buffer.from(file)
            : file
        await this.write(fileBuffer, savePath)

        return this.noServerAlt
            ? url.pathToFileURL(savePath).href
            : `${this.baseUrlAlt}/${name}`
    }

    public async initServer() {
        await super.initServer()

        this.ctx.server.put(this.pathAlt, async (ktx) => {
            const {
                query: { salt, sign },
                request: { files: { asset } }
            } = ktx
            if (asset instanceof Array) return ktx.status = 400

            const { originalFilename: name } = asset

            if (this.config.secret) {
                if (! salt || ! sign) return ktx.status = 400
                const hash = createHmac('sha1', this.config.secret).update(name + salt).digest('hex')
                if (hash !== sign) return ktx.status = 403
            }

            const assetStream = fs.createReadStream(asset.filepath)
            const assetBuffer = await streamToBuffer(assetStream)

            try {
                const assetUrl = await this.uploadFile(assetBuffer, name)
                ktx.status = 200
                ktx.body = assetUrl
            }
            catch (errCode) {
                return ktx.status = errCode
            }
        })
    }
}

namespace LocalAltAssets {
    export interface Config extends LocalAssets.Config {}

    export const Config: z<Config> = z(JSON.parse(JSON.stringify(LocalAssets.Config)))
}

export default LocalAltAssets