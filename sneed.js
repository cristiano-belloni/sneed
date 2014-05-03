define(['require',
    'github:ajaxorg/ace-builds@master/src-min-noconflict/ace',], function(require, ace) {

    var pluginConf = {
        audioOut: 1,
        audioIn: 1,
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

    var initPlugin = function(args, resources) {
        
        this.name = args.name;
        this.id = args.id;
        this.audioSource = args.audioSources[0];
        this.audioDestination = args.audioDestinations[0];
        this.context = args.audioContext;
        this.domEl = args.div;
        this.domEl.style.height = pluginConf.ui.height+'px';

        var editor = ace.edit(this.domEl);
        editor.setFontSize("14px");
        //editor.setTheme("ace/theme/mono_industrial");
        //editor.getSession().setMode("ace/mode/javascript");
        editor.setValue("// Ctrl-S or Cmd-S when code window is on focus executes code.\n// this.source = source node\n// this.dest = destination node\n// this.context = audio context\n// Example: this.source.connect (this.dest);");
        editor.clearSelection();
        
        editor.commands.addCommand({
            name: 'saveCommand',
            bindKey: {win: 'Ctrl-S',  mac: 'Command-S'},
            exec: function(editor) {
                console.log ("Intercepted save command, editor is", editor);
                var code = editor.getValue();
                console.log ("And code is", code);
            }.bind(this),
            readOnly: true // false if this command should not apply in readOnly mode
        });

        // Initialization made it so far: plugin is ready.
        args.hostInterface.setInstanceStatus ('ready');
    };
        
    return {
        initPlugin: initPlugin,
        pluginConf: pluginConf
    };
});