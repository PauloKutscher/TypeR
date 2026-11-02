const fs = require('fs');
const path = require('path');
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const HtmlWebpackPlugin = require('html-webpack-plugin');
const postcssPresetEnv = require('postcss-preset-env');
const autoprefixer = require('autoprefixer');
const postcssCssnano = require('cssnano');
const UglifyJS = require('uglify-js');


const hostFiles = [
    __dirname + '/app_src/lib/jam/jamActions.jsxinc',
    __dirname + '/app_src/lib/jam/jamEngine.jsxinc',
    __dirname + '/app_src/lib/jam/jamHelpers.jsxinc',
    __dirname + '/app_src/lib/jam/jamJSON.jsxinc',
    __dirname + '/app_src/lib/jam/jamText.jsxinc',
    __dirname + '/app_src/lib/jam/jamStyles.jsxinc',
    __dirname + '/app_src/lib/jam/jamUtils.jsxinc',
    __dirname + '/app_src/fontVariantResolver.jsxinc',
    __dirname + '/app_src/bubbleGeometry.jsxinc',
    __dirname + '/app_src/host.js'
].map(file => path.normalize(file));

class HostScriptPlugin {
    constructor(production = false) { this.production = production; }
    apply(compiler) {
        compiler.hooks.thisCompilation.tap('TypeRHost', compilation => {
            hostFiles.forEach(file => compilation.fileDependencies.add(file));
            compilation.hooks.processAssets.tap({ name: 'TypeRHost', stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL }, () => {
                let code = hostFiles.map(file => fs.readFileSync(file, 'utf8')).join('\n');
                if (this.production) {
                    const result = UglifyJS.minify(code, { compress: false, output: { beautify: true, indent_level: 0, quote_keys: true } });
                    if (result.error) throw result.error;
                    code = result.code.replace(/([{};:,])\s*\n+\s*/gi, '$1').replace(/\s*\n+\s*([})\];:,])/gi, '$1');
                }
                compilation.emitAsset('host.jsx', new compiler.webpack.sources.RawSource(code));
            });
        });
    }
}


const defaultConfig = {
    entry: {
        index: ['./app_src/index.jsx']
    },
    output: {
        path: __dirname + '/app/',
        filename: 'index.js',
        chunkFilename: '[name].[contenthash:12].index.js',
        publicPath: './'
    },
    resolve: {
        extensions: ['.js', '.jsx', '.jsxinc']
    }
};

const devConfig = {
    mode: 'development',
    devtool: 'source-map',
    module: {
        rules: [
            {
                test: /\.m?jsx?$/,
                exclude: /node_modules/,
                use: {
                    loader: 'babel-loader'
                }
            }, {
                test: /\.css$/,
                use: {
                    loader: 'file-loader'
                }
            }, {
                test: /\.scss$/,
                use: [
                    {
                        loader: MiniCssExtractPlugin.loader
                    }, {
                        loader: 'css-loader',
                        options: {
                            sourceMap: true
                        }
                    }, {
                        loader: 'postcss-loader',
                        options: {
                            sourceMap: true,
                            postcssOptions: {
                                plugins: [
                                    postcssPresetEnv(),
                                    autoprefixer()
                                ]
                            }
                        }
                    }, {
                        loader: 'sass-loader',
                        options: {
                            sourceMap: true
                        }
                    }
                ]
            }, {
                test: /\.(gif|png|jpe?g|svg)$/,
                loader: 'file-loader'
            }, {
                test: /\.(woff|woff2|eot|otf|ttf)?$/,
                loader: 'base64-inline-loader'
            }
        ]
    },
    plugins: [
        new HtmlWebpackPlugin({
            template: './app_src/index.html',
            filename: 'index.html'
        }),
        new MiniCssExtractPlugin({ chunkFilename: "[name].[contenthash:12].css" }),
        new HostScriptPlugin()
    ]
};

const prodConfig = {
    mode: 'production',
    module: {
        rules: [
            {
                test: /\.m?jsx?$/,
                exclude: /node_modules/,
                use: {
                    loader: 'babel-loader'
                }
            }, {
                test: /\.css$/,
                use: {
                    loader: 'file-loader'
                }
            }, {
                test: /\.scss$/,
                use: [
                    {
                        loader: MiniCssExtractPlugin.loader
                    }, {
                        loader: 'css-loader'
                    }, {
                        loader: 'postcss-loader',
                        options: {
                            postcssOptions: {
                                plugins: [
                                    postcssPresetEnv(),
                                    postcssCssnano(),
                                    autoprefixer()
                                ]
                            }
                        }
                    }, {
                        loader: 'sass-loader'
                    }
                ]
            }, {
                test: /\.(gif|png|jpe?g|svg)$/,
                loader: 'file-loader'
            }, {
                test: /\.(woff|woff2|eot|otf|ttf)?$/,
                loader: 'base64-inline-loader'
            }
        ]
    },
    plugins: [
        new HtmlWebpackPlugin({
            template: './app_src/index.html',
            filename: 'index.html',
            minify: {
                removeComments: true,
                collapseWhitespace: true,
                removeAttributeQuotes: true,
                removeEmptyAttributes: true,
                collapseBooleanAttributes: true,
                removeScriptTypeAttributes: true,
                removeStyleLinkTypeAttributes: true
            }
        }),
        new MiniCssExtractPlugin({ chunkFilename: "[name].[contenthash:12].css" }),
        new HostScriptPlugin(true)
    ]
};

function clientConfig(env, argv, legacy) {
    const source = argv.mode === 'development' ? devConfig : prodConfig;
    const flavor = legacy ? 'legacy' : 'modern';
    const rules = source.module.rules.map(rule => {
        if (String(rule.test) !== String(/\.m?jsx?$/)) {
            if (!legacy || !Array.isArray(rule.use)) return rule;
            return Object.assign({}, rule, { use: rule.use.map(loader => {
                if (loader.loader !== 'postcss-loader') return loader;
                return Object.assign({}, loader, { options: { postcssOptions: { plugins: [postcssPresetEnv(), autoprefixer(), require('./scripts/legacyCss')()] } } });
            }) });
        }
        return {
            test: /\.m?jsx?$/,
            exclude: /node_modules[\\/](?!react-icons[\\/]|fflate[\\/])/,
            use: { loader: 'babel-loader', options: {
                babelrc: false, configFile: false,
                presets: ['@babel/preset-react', ['@babel/preset-env', { targets: { chrome: legacy ? '41' : '74' }, forceAllTransforms: legacy, useBuiltIns: 'usage', corejs: 3 }]],
                plugins: ['@babel/plugin-transform-runtime']
            } }
        };
    });
    const plugins = source.plugins.filter(plugin => !(plugin instanceof HtmlWebpackPlugin) && !(plugin instanceof MiniCssExtractPlugin) && !(legacy && plugin instanceof HostScriptPlugin));
    plugins.push(new HtmlWebpackPlugin({ template: './app_src/index.html', filename: flavor + '.html' }));
    plugins.push(new MiniCssExtractPlugin({ filename: flavor + '.css', chunkFilename: flavor + '.[name].[contenthash:12].css' }));
    return Object.assign({}, defaultConfig, source, {
        name: flavor,
        target: ['web', legacy ? 'es5' : 'es2017'],
        entry: { index: legacy ? ['./app_src/legacyCompat.js', './app_src/index.jsx'] : ['./app_src/index.jsx'] },
        output: Object.assign({}, defaultConfig.output, { filename: flavor + '.index.js', chunkFilename: flavor + '.[name].[contenthash:12].index.js' }),
        module: { rules }, plugins
    });
}
module.exports = (env, argv) => [clientConfig(env, argv, false), clientConfig(env, argv, true)];
