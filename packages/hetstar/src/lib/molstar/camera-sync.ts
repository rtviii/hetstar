import type { Camera } from "molstar/lib/mol-canvas3d/camera";
import { Vec3 } from "molstar/lib/mol-math/linear-algebra";

// Pose sync between several Mol* cameras: every member looks along the same direction with
// the same up vector, and nothing else is shared. A free member (the main view) keeps its
// own target and distance, so zooming and panning it never reaches the others; a fitted
// member (a switchboard box) is always placed to frame its sphere, which also undoes any
// zoom or pan that reaches it.
//
// Each plugin renders on its own animation frame, and Camera.changed fires from inside
// that frame's update: a pose written to a follower comes back as its own change event one
// frame later. The guard is therefore by value, not by a re-entrancy flag: a member
// remembers the pose it last had, and a change event that still matches it is not a
// rotation.

export interface FitSphere {
  center: Vec3;
  radius: number;
}

export interface PoseMember {
  leave(): void;
  /** re-place a fitted member: its sphere or its viewport changed */
  refit(): void;
}

export interface PoseGroup {
  join(camera: Camera, opts?: { fitted?: () => FitSphere | null }): PoseMember;
}

interface Member {
  camera: Camera;
  fitted?: () => FitSphere | null;
  dir: Vec3;
  up: Vec3;
  placed: boolean;
}

const POSE_EPSILON = 1e-10;
/** the clipping and fog radius of a fitted camera, past the sphere it frames, so anything
 * drawn at the model's edge (a looking glass) is not cut by the far plane */
const RADIUS_MARGIN = 1.25;
const FIT_TOLERANCE = 1e-3;

function sameDirection(a: Vec3, b: Vec3): boolean {
  return 1 - Vec3.dot(a, b) < POSE_EPSILON;
}

function readPose(camera: Camera, dir: Vec3, up: Vec3): void {
  Vec3.normalize(dir, Vec3.sub(dir, camera.target, camera.position));
  Vec3.normalize(up, camera.up);
}

export function createPoseGroup(): PoseGroup {
  const members = new Set<Member>();
  let pose: { dir: Vec3; up: Vec3 } | null = null;
  const scratchDir = Vec3();
  const scratchUp = Vec3();

  const place = (member: Member, dir: Vec3, up: Vec3) => {
    const camera = member.camera;
    if (member.fitted) {
      const sphere = member.fitted();
      // nothing to frame yet: stay unplaced, so this camera's default pose never drives
      if (!sphere) {
        member.placed = false;
        return;
      }
      const distance = camera.getTargetDistance(sphere.radius);
      camera.setState(
        {
          target: Vec3.clone(sphere.center),
          position: Vec3.scaleAndAdd(Vec3(), sphere.center, dir, -distance),
          up: Vec3.clone(up),
          radius: sphere.radius * RADIUS_MARGIN,
          radiusMax: sphere.radius * RADIUS_MARGIN,
        },
        0,
      );
    } else {
      const distance = Vec3.distance(camera.position, camera.target);
      camera.setState({ position: Vec3.scaleAndAdd(Vec3(), camera.target, dir, -distance), up: Vec3.clone(up) }, 0);
    }
    Vec3.copy(member.dir, dir);
    Vec3.copy(member.up, up);
    member.placed = true;
  };

  const offFit = (member: Member): boolean => {
    const sphere = member.fitted?.();
    if (!sphere) return false;
    const camera = member.camera;
    const distance = camera.getTargetDistance(sphere.radius);
    return (
      Vec3.distance(camera.target, sphere.center) > FIT_TOLERANCE * sphere.radius ||
      Math.abs(Vec3.distance(camera.position, camera.target) - distance) > FIT_TOLERANCE * distance ||
      Math.abs(camera.state.radius - sphere.radius * RADIUS_MARGIN) > FIT_TOLERANCE * sphere.radius
    );
  };

  const adopt = (member: Member) => {
    pose = { dir: Vec3.clone(scratchDir), up: Vec3.clone(scratchUp) };
    Vec3.copy(member.dir, pose.dir);
    Vec3.copy(member.up, pose.up);
    member.placed = true;
    if (offFit(member)) place(member, pose.dir, pose.up);
    for (const other of members) {
      if (other !== member) place(other, pose.dir, pose.up);
    }
  };

  const onChanged = (member: Member) => {
    if (member.fitted && !member.fitted()) return;
    if (!member.placed && pose) {
      place(member, pose.dir, pose.up);
      return;
    }
    readPose(member.camera, scratchDir, scratchUp);
    if (member.placed && sameDirection(scratchDir, member.dir) && sameDirection(scratchUp, member.up)) {
      if (offFit(member)) place(member, member.dir, member.up);
      return;
    }
    adopt(member);
  };

  return {
    join(camera, opts = {}) {
      const member: Member = { camera, fitted: opts.fitted, dir: Vec3(), up: Vec3(), placed: false };
      members.add(member);
      if (member.fitted) {
        if (pose) place(member, pose.dir, pose.up);
      } else {
        // a free camera is the reference: the group takes its pose as it stands
        readPose(camera, scratchDir, scratchUp);
        adopt(member);
      }
      const subscription = camera.changed.subscribe(() => onChanged(member));
      return {
        leave() {
          subscription.unsubscribe();
          members.delete(member);
        },
        refit() {
          if (pose) place(member, pose.dir, pose.up);
        },
      };
    },
  };
}
