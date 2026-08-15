const MergeIntoSingleFilePlugin = require('webpack-merge-and-include-globally');
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
    __dirname + '/app_src/host.js'
];


const defaultConfig = {
    entry: {
        index: ['./app_src/index.jsx']
    },
    output: {
        path: __dirname + '/app/',
        filename: 'index.js',
        chunkFilename: '[name].index.js',
        publicPath: './',
        hashFunction: 'xxhash64'
    },
    resolve: {
        extensions: ['.js', '.jsx', '.jsxinc']
    },
    cache: {
        type: 'filesystem',
        buildDependencies: {
            config: [__filename]
        }
    }
};

const devConfig = {
    mode: 'development',
    devtool: 'eval-cheap-module-source-map',
    module: {
        rules: [
            {
                test: /\.jsx?$/,
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
                            sourceMap: true,
                            sassOptions: {
                                quietDeps: true,
                                silenceDeprecations: ['legacy-js-api']
                            }
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
        new MiniCssExtractPlugin(),
        new MergeIntoSingleFilePlugin({
            files: {
                'host.jsx': hostFiles
            }
        })
    ]
};

const prodConfig = {
    mode: 'production',
    module: {
        rules: [
            {
                test: /\.jsx?$/,
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
                        loader: 'sass-loader',
                        options: {
                            sassOptions: {
                                quietDeps: true,
                                silenceDeprecations: ['legacy-js-api']
                            }
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
    optimization: {
        minimize: true
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
        new MiniCssExtractPlugin(),
        new MergeIntoSingleFilePlugin({
            files: {
                'host.jsx': hostFiles
            },
            transform: {
                'host.jsx': code => {
                    const res = UglifyJS.minify(code, {compress: false, output: {beautify: true, indent_level: 0, quote_keys: true}});
                    return res.code.replace(/([{};:,])\s*\n+\s*/gi, '$1').replace(/\s*\n+\s*([})\];:,])/gi, '$1');
                }
            }
        })
    ]
};

function clientConfig(env, argv) {
    const envConfig = (argv.mode === 'development') ? devConfig : prodConfig;
    return Object.assign({}, defaultConfig, envConfig);
}

module.exports = [clientConfig];
