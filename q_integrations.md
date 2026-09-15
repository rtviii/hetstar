Ok what we have to do today is prototype the following.
Logic and infrasturcture:

- we don't currently have good support for ensemble structure (that is ) -- i'm not even sure they will load well with what we are doing and the funcitonality we aim to support, but let's try
- the sequence viewer is lagggy when i drag a selection over it.. can we make it snappier?  Actually it seems to be a bit better when i select fewer lanes. I thought it had to do with molstar or something... in the case the selection is laggy JUST due to the fuckign lanes -- we can debounce it or something. 
- the "Color by"  and other dropdowns entries should be capitalized and not fucking abbreviated -- no "Occ entropy" dude. No obscurantism..

- let's pull in PDBe domains or whatever, so we indeed have the full annotations that PDB has for a given structure.. 


- let's organize the side bar a bit: the "Metrics" that are there right afair all refer to painting the "metric" on the density. So let's make it explicit by putting them into the radial circles icon at top right as a dropdown so it's easy to navigate this interface and it is clear that these things refer to the density, nothing else.. I think we will use quite a bit more space here in this dropdown so make it organized (not just a dump of metric names). Furthermore i want to retain the ability to toggle densities by just clicking this thing so let's make it so hovering over it opens this panel with metrics (And later other stuff) while clicking it on and off actually toggles the molstar density cloud... Map opacity, sigma, fofc's all move here to the top...


The next thing in this panel is "Selection" and it only shows stuff if a single residue is selected. We should adapt it to report on ANY selection. Actually there's going to be a whole slew of comparison/selection metrics here so let's in fact create the third top-right icon with some multiconformer-resembling icon and and put all this occupancy/seelction stuff in there like for density (also put the Conformer State panel into there to clear up space on the bottom.)

I think this basically clear out the left sidepanel almost entirly. We can now actually mkae it presentable and a bit closer to what's eventually go be on the website. That is, we should at least somehwat describe what this structure is (id, deposition, provenance, some global metric,s species etc.) -- make the text tiny, compact, organized and neatly positioned. This is more a formaltity than anythign, but it must be there.. you can poach ideas from this doc that we are keeping.Same for the chain (you can add some relevant descriptions and metrics on the header of the sequence viwer):(i'm attaching):

------------

Ok slightly better. But now let's make it a lot more organized and fix spacing/sizing everywhere. 
Firstly -- remove the slice box from the bottom panel. The horizontal space in the bottom panel is JUST for the sequence/lanes viewer...
The lanes sometimes don't display correctly or are too narrow to dislay the text they contain -- make the text smaller/more compact, reduce the height of the rows themselves slightly. The whole lane viewer should be vertically scrollable...

On ligand contacts lane -- when i click one/inside one of the green boxes i still only select a single residue -- if i click in the box i expect that whole range of residues be selected. Also, if we can let's partition each invidivual ligand into their own lane optionally -- that is they are all overlapping on the same lane by default, but the user can click a + icon next to the lane header to see each ligand in their own lane individually. You can rely on some general shape of the how i built it in tubulinxyz (relying on nightingale admitedly).

Density should be loaded in the background but off by default... 

Let's make the text and draggers more compact and smaller in three top-right panels (conformers, density, representation), more in line with style with the rest of the viewer. Maps enabling/disabling should go at the very top of the panel.

Why are ligands not rendered in the atomic model?

Representation buttons are completely broken: spheres does nothing, cartoon does nothing, stick thickness and stick vs ball make no sense when default "stkcks" is active. Just make sure we have "cartoon","sticks&balls"(default) and "atoms" working.

Further, lets improve the molstar-related selection logic and right-click selection actions:

- i want residues and ranged to be ADDED to selection if i hold shift while left-clickign something (either a range on the residues in the sequence viewer or actual residues in molstar)
- IF a selection includes anything (includes one residue or more) i wnat the right click to call up the actions panel -- no matter where the click happened, even if it's no directly on top of any given residue. The selection panel should really compactly describe the selection at the top and then list the applicable actions. We will wokr on expanding the set of these actions in the next session..