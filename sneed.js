define(['require',
    'github:ajaxorg/ace-builds@master/src-min-noconflict/ace'
    ], function(require, ace, chuck) {

    var pluginConf = {
        audioOut: 1,
        audioIn: 0,
        name: "Sneed",
        version: '0.0.1',
        hyaId: 'SNEED-PREVIOUSLY-CHUCK',
        ui: {
            type: 'div',
            width: 400,
            height: 400,
            html: "<div></div>",
            css: ""
        }
    }

    var initPlugin = function(initArgs) {

        require (['./chuckjs/dist/chuck-noamd'], function () {
            console.log (arguments);

            this.name = initArgs.name;
            this.id = initArgs.id;
            this.audioDestination = initArgs.audioDestinations[0];
            this.context = initArgs.audioContext;
            this.domEl = initArgs.div;
            this.domEl.style.height = pluginConf.ui.height+'px';
            this.chuckModule = arguments[0].chuck;
            this.code = "";

            if (initArgs.initialState && initArgs.initialState.data) {
                /* Load data */
                this.code = initArgs.initialState.data;
            }

            this.chuck = new this.chuckModule.Chuck(this.context, this.audioDestination);

            var editor = ace.edit(this.domEl);
            editor.setFontSize("14px");
            //editor.setTheme("ace/theme/mono_industrial");
            //editor.getSession().setMode("ace/mode/javascript");
            editor.clearSelection();
            editor.setValue (this.code, -1);

            editor.commands.addCommand({
                name: 'runCommand',
                bindKey: {win: 'Ctrl-R',  mac: 'Command-R'},
                exec: function(editor) {
                    console.log ("Intercepted save command, editor is", editor);
                    this.code = editor.getValue();
                    console.log ("And code is", this.code);
                    try {
                        this.chuck.execute(this.code).done(function () {
                            console.log("The program finished playing");
                        });
                    }
                    catch (e) {
                        console.log ("Whoops, exception from ChucK!");
                    }
                }.bind(this),
                readOnly: true // false if this command should not apply in readOnly mode
            });

            editor.commands.addCommand({
                name: 'haltCommand',
                bindKey: {win: 'Ctrl-H',  mac: 'Command-H'},
                exec: function(editor) {
                    console.log ("Intercepted save command, editor is", editor);
                    this.code = editor.getValue();
                    console.log ("And code is", this.code);
                    this.chuck.stop();
                }.bind(this),
                readOnly: true // false if this command should not apply in readOnly mode
            });

            var saveState = function () {
                this.code = editor.getValue();
                return { data: this.code };
            };
            initArgs.hostInterface.setSaveState (saveState.bind (this));

            // Initialization made it so far: plugin is ready.
            initArgs.hostInterface.setInstanceStatus ('ready');
        });
    };
        
    return {
        initPlugin: initPlugin,
        pluginConf: pluginConf
    };
});