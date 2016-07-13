# Easy to use TiddlyWiki 5 plugins.

Just clone the repo into your lokal `wikilabs` directory. eg:

```
cd d:\
mkdir wikilabs
cd wikilabs
git clone https://github.com/wikilabs/plugins.git
```


## Preparations for TiddlyWiki

Set your environment variables, so tiddlywiki command line can find them.

windows: list existing variables


```
ls env:

or

ls env: | findstr  TIDDLY
```

windows: temporarily set variables for one session

```
$env:TIDDLYWIKI_PLUGIN_PATH="LW:\your\full\path\plugins"

eg:

$env:TIDDLYWIKI_PLUGIN_PATH="d:\wikilabs\plugins"
```

It's possible to set several paths in the variable. eg:

```
$env:TIDDLYWIKI_PLUGIN_PATH="d:\wikilabs\plugins;d:\pmario\plugins"
```

HoTo set environment variables permanently [click this link](https://www.google.at/search?q=set+environment+variables+windows10)


## Usage

Create an edition with eg: `tiddlywiki edition/helloWorld --init edition-template`. If `edition-template` doesn't exist. See: https://github.com/wikilabs/editions


Open your editions `tiddlywiki.info` file and change the `plugins` section according to your needs.

```
{
    "description": "Edition Boilerplate - CHANGE THIS!",
    "plugins": [
        "wikilabs/pluginName"           <--------------------------
    ],
    "themes": [
        "tiddlywiki/vanilla",
        "tiddlywiki/snowwhite"
    ],
    "build": {
        "index": [
            "--rendertiddler", "$:/core/save/all", "index.html", "text/plain"
        ],

...
...

    }
}
```

Start your favorite editor and happy hacking!

have fun!<br>
mario
