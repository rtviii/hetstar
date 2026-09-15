

Ok let's keep fixing this shit. First of all right now when the structure loads there is usually nothing rendered here and it's fucking annoying. I susepct it has to do with the recent changes we've made to representatiosn... somettimes i can see some black balls flying around...


Let's add the default molstar aciton of resetting the camera/view on a central mouse click please.

Let's find some ensemble model examples please so i can prototype those meatier views...

Please take a look at how I display bonds in tubulinxyz and let's add full support for them: that is, they should be displayed among the selection overview (if there are more than 10 -- make a separate dropdown for them...). Also, just stylistically -- let's adopt this style (from tubulinxyz) with muted colors, formal fonts and transparent backgrounds for ephemeral panels. I think it looks nicer than whatever the fuck we have going on now, but we can still keep the purple/magenta highlights from the dynamicpdb styling...


----- 

Selection tools:

Let's further develop selection tooling: right now i can only add to selection via shift click -- let's make sure that if something is shift-clicked that is already a part of the selection -- it is RMEOVED from the selection, just liek a file browser in any OS. that is more intuitive. Furthremroe let's make sure the right click selection actions panel can be called up even if there is NO selection active. There -- put tiny icons at the top signifying two modes -- atom/bondswise selectiosn and residue wise selection ( atomwise should include bonds). The user should be able to freely swtich between the two -- to add more fine-grained atomic elements to their selection. Furthermore, let's createa a selection-snapshotting mechanism: in the top right corneer we currently have 3 icons: density, conformers, repr settings -- whenever user has a selection active they can open the selection actions right lcick menu and press the "bookmark" icon -- this should save thep particular selection with all of its active representation as a numbered icons that stack on the left of the desnity icon. Then if they lose or extend or leave the selection entirely -- they should be able to click one of these bookmarks to fully resurrect that selection on this given structure with all of its representation intact. We should probably save this in browser cache as well so it persist between reloads. How does that sound?

---

The 3d viewer interface should be faintly blocked with a spinner while the bundle is loading so it doesnt look so janky to the user...

Let's find an ensemlbe model to prototopy things with...

"Bookmark selection" should be an icon not a whole fucking huge row button. The should also be a button in the selection for the bonds to be displayed also between selected atoms and conformers and ensembles. Because right now in the selection overview i can see the connecting bonds listed but they are not actually painted between the residues.. 

Active bookmarks should each have a tooltip on hover and the user should be able to cross-icon-clikc delete them.

One thing that looks super buggy right now is the fact that when i select one residue -- both the current active model/conformer is highlighted in green, but also the ghost of the other [confromer, i suspect] so the green outline looks incredibly off -- can we make sure only the currnet one is highlighted for the clarity of interaction, but of course if the user has that residue (or atom) selected the actiosn (like chaning representation) should generalize to all conformers in that residue/selection...

Regarding the selection tools panel: it coould be a lot more compact, fucntional and minimal. By that i mean let's make the fonts much smaller, the layout more sectioned and compact since there is goign to be a lot more tools arriving here. For now lets get rid of the "SELECT BY" line and always in general opt for tooltips over tools rahter than inline text for explanations. "Show conformers colored as above" should alos reuse our "conformer" icon. Clip around residue should read "clip around selection". Radius dragger can be smaller. 

Let's also add a distances tool here in the cofnormer section. Let me try to describe it to you. Distances between conformers tool: one thing i would like to prototype further is based on the molstar "measurement" functionality -- i think one can basically create visual elements between two atomic selections that would display distances... (And any other stuff? -- can you actually please research this and tell me what else they offer/calculate that can be useful for us and wheter we can implement our own metrics on top of this visual eleement functioanlity...). For now the utilit i see in this is basically being able to see inside a single residue/tom or general selection how much distances there are between the cofnormers that constitute it.. Tell me if you think that this is not useful or somethign else might be more useufl -- generally interested in your thoguhts here...