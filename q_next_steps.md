Okie dokie, i would like to improve the website UI and capabilities here..

Let me rattle off the obvious shit that works super poorly right now and then give some more detailed feedback on certain things. Feel free to ask me as many questiosn as you need so we solve each one thoroughly and principally, not just monkey patch some bullshit.

First of all, styles(all of this ought to go in small toolbar icon tray where "desnity on" sits right now ):
- we definitely should have a quality of density knob like vanilla mstar has.
- the representations should be switchable between atomic, stick and ball and cartoon. We may want to equip each of these types with some settings that would be useful for this viewer in the context of dynamic pdb( ex. paint atoms differnetly by type, ball and stick we should be able to vary the thickness of sticks etc.)

The panle at the very bottom "confomrers per residue" seems to have buttons and ui elements taht are plainly invisible (i assume that this is where my 1d graph lives right now too.) Let's fix that i want to see what the fuck we have there.

For the "Entry" -- i like that __sources__ collapses all the auxilary data on where the files come from but you should mkae it more organized and point to bonafide links or full abspaths where possible. All in tiny font etc. but feel free to make this popup tooltip a lot bigger. This is important info. the fucking "/spike" should be removed from all the user facing stuff in the app. Nobody knows wht ath fuck it is and its just you using the jargon you came up with like it's a standard path. Eiether describe the model with words or describe the path/mechanism by which you obtained it.

REarding the slice viewer: how the fuck is the picture of the density slice even generated man? Are there maybe javascript viewers that implement something like this already that we don't have to reinvent the wheel...? it's literally pixelated and completely noninteracitve, just displays some low res shit. pretyt useless at the moment. 

Now, regardin the  "compare" part of this, aka top right panel. All the metrics in there cite multiple models (A and B). Is my understanding correct then that behind the scenes we are comparing the deposited (vanilla pdb model) to the re-refined one from wankowitz? Let's make this explicit in the interface and provide them as defaults for those metric that require multiple modles, but these should OBVIOUSLY be changeable inputs.

The clicks to open the local actions panel don't "get throguh" to the resiude or the conformer if they are active/displayed two thirds of the time. I'm not sure whether it's realated to the density or something else but it's an extremely annoying thing. Let's also add an opacity dragger for density btw so the user can almost hide it... Let's start here..