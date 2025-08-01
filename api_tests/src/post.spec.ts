jest.setTimeout(120000);

import { CommunityView } from "lemmy-js-client/dist/types/CommunityView";
import {
  alpha,
  beta,
  gamma,
  delta,
  epsilon,
  setupLogins,
  createPost,
  editPost,
  featurePost,
  lockPost,
  resolvePost,
  likePost,
  followBeta,
  resolveBetaCommunity,
  createComment,
  deletePost,
  delay,
  removePost,
  getPost,
  unfollowRemotes,
  resolvePerson,
  banPersonFromSite,
  followCommunity,
  banPersonFromCommunity,
  reportPost,
  randomString,
  registerUser,
  unfollows,
  resolveCommunity,
  waitUntil,
  waitForPost,
  alphaUrl,
  loginUser,
  createCommunity,
  listReports,
  getMyUser,
  listNotifications,
  getModlog,
} from "./shared";
import { PostView } from "lemmy-js-client/dist/types/PostView";
import { AdminBlockInstanceParams } from "lemmy-js-client/dist/types/AdminBlockInstanceParams";
import {
  AddModToCommunity,
  EditSite,
  EditPost,
  PostReport,
  PostReportView,
  ReportCombinedView,
  ResolveObject,
  ResolvePostReport,
  LemmyError,
} from "lemmy-js-client";

let betaCommunity: CommunityView | undefined;

beforeAll(async () => {
  await setupLogins();
  betaCommunity = await resolveBetaCommunity(alpha);
  expect(betaCommunity).toBeDefined();

  // Hack: Force outgoing federation queue for beta to be created on epsilon,
  // otherwise report test fails
  let person = await resolvePerson(epsilon, "@lemmy_beta@lemmy-beta:8551");
  expect(person?.person).toBeDefined();
});

afterAll(unfollows);

async function assertPostFederation(
  postOne: PostView,
  postTwo: PostView,
  waitForMeta = true,
) {
  // Link metadata is generated in background task and may not be ready yet at this time,
  // so wait for it explicitly. For removed posts we cant refetch anything.
  if (waitForMeta) {
    postOne = await waitForPost(beta, postOne.post, res => {
      return res === null || !!res?.post.embed_title;
    });
    postTwo = await waitForPost(
      beta,
      postTwo.post,
      res => res === null || !!res?.post.embed_title,
    );
  }

  expect(postOne?.post.ap_id).toBe(postTwo?.post.ap_id);
  expect(postOne?.post.name).toBe(postTwo?.post.name);
  expect(postOne?.post.body).toBe(postTwo?.post.body);
  // TODO url clears arent working
  // expect(postOne?.post.url).toBe(postTwo?.post.url);
  expect(postOne?.post.nsfw).toBe(postTwo?.post.nsfw);
  expect(postOne?.post.embed_title).toBe(postTwo?.post.embed_title);
  expect(postOne?.post.embed_description).toBe(postTwo?.post.embed_description);
  expect(postOne?.post.embed_video_url).toBe(postTwo?.post.embed_video_url);
  expect(postOne?.post.published_at).toBe(postTwo?.post.published_at);
  expect(postOne?.community.ap_id).toBe(postTwo?.community.ap_id);
  expect(postOne?.post.locked).toBe(postTwo?.post.locked);
  expect(postOne?.post.removed).toBe(postTwo?.post.removed);
  expect(postOne?.post.deleted).toBe(postTwo?.post.deleted);
}

test("Create a post", async () => {
  // Block alpha
  var block_instance_params: AdminBlockInstanceParams = {
    instance: "lemmy-alpha",
    block: true,
  };
  await epsilon.adminBlockInstance(block_instance_params);

  if (!betaCommunity) {
    throw "Missing beta community";
  }

  let postRes = await createPost(
    alpha,
    betaCommunity.community.id,
    "https://example.com/",
    "აშშ ითხოვს ირანს დაუყოვნებლივ გაანთავისუფლოს დაკავებული ნავთობის ტანკერი",
  );
  expect(postRes.post_view.post).toBeDefined();
  expect(postRes.post_view.community.local).toBe(false);
  expect(postRes.post_view.creator.local).toBe(true);
  expect(postRes.post_view.post.score).toBe(1);

  // Make sure that post is liked on beta
  const betaPost = await waitForPost(
    beta,
    postRes.post_view.post,
    res => res?.post.score === 1,
  );

  expect(betaPost).toBeDefined();
  expect(betaPost?.community.local).toBe(true);
  expect(betaPost?.creator.local).toBe(false);
  expect(betaPost?.post.score).toBe(1);
  await assertPostFederation(betaPost, postRes.post_view);

  // Delta only follows beta, so it should not see an alpha ap_id
  await expect(
    resolvePost(delta, postRes.post_view.post),
  ).rejects.toStrictEqual(new LemmyError("not_found"));

  // Epsilon has alpha blocked, it should not see the alpha post
  await expect(
    resolvePost(epsilon, postRes.post_view.post),
  ).rejects.toStrictEqual(new LemmyError("not_found"));

  // remove blocked instance
  block_instance_params.block = false;
  await epsilon.adminBlockInstance(block_instance_params);
});

test("Create a post in a non-existent community", async () => {
  await expect(createPost(alpha, -2)).rejects.toStrictEqual(
    new LemmyError("not_found"),
  );
});

test("Unlike a post", async () => {
  if (!betaCommunity) {
    throw "Missing beta community";
  }
  let postRes = await createPost(alpha, betaCommunity.community.id);
  let unlike = await likePost(alpha, 0, postRes.post_view.post);
  expect(unlike.post_view.post.score).toBe(0);

  // Try to unlike it again, make sure it stays at 0
  let unlike2 = await likePost(alpha, 0, postRes.post_view.post);
  expect(unlike2.post_view.post.score).toBe(0);

  // Make sure that post is unliked on beta
  const betaPost = await waitForPost(
    beta,
    postRes.post_view.post,
    post => post?.post.score === 0,
  );

  expect(betaPost).toBeDefined();
  expect(betaPost?.community.local).toBe(true);
  expect(betaPost?.creator.local).toBe(false);
  expect(betaPost?.post.score).toBe(0);
  await assertPostFederation(betaPost, postRes.post_view);
});

test("Make sure like is within range", async () => {
  if (!betaCommunity) {
    throw "Missing beta community";
  }
  let postRes = await createPost(alpha, betaCommunity.community.id);

  // Try a like with score 2
  await expect(
    likePost(alpha, 2, postRes.post_view.post),
  ).rejects.toStrictEqual(new LemmyError("couldnt_like_post"));

  // Try a like with score -2
  await expect(
    likePost(alpha, -2, postRes.post_view.post),
  ).rejects.toStrictEqual(new LemmyError("couldnt_like_post"));

  // Make sure that post stayed at 1
  const betaPost = await waitForPost(
    beta,
    postRes.post_view.post,
    post => post?.post.score === 1,
  );

  expect(betaPost).toBeDefined();
  expect(betaPost?.community.local).toBe(true);
  expect(betaPost?.creator.local).toBe(false);
  expect(betaPost?.post.score).toBe(1);
  await assertPostFederation(betaPost, postRes.post_view);
});

test("Update a post", async () => {
  if (!betaCommunity) {
    throw "Missing beta community";
  }
  let postRes = await createPost(alpha, betaCommunity.community.id);
  await waitForPost(beta, postRes.post_view.post);

  let updatedName = "A jest test federated post, updated";
  let updatedPost = await editPost(alpha, postRes.post_view.post);
  expect(updatedPost.post_view.post.name).toBe(updatedName);
  expect(updatedPost.post_view.community.local).toBe(false);
  expect(updatedPost.post_view.creator.local).toBe(true);

  // Make sure that post is updated on beta
  let betaPost = await waitForPost(beta, updatedPost.post_view.post);
  expect(betaPost.community.local).toBe(true);
  expect(betaPost.creator.local).toBe(false);
  expect(betaPost.post.name).toBe(updatedName);
  await assertPostFederation(betaPost, updatedPost.post_view);

  // Make sure lemmy beta cannot update the post
  await expect(editPost(beta, betaPost.post)).rejects.toStrictEqual(
    new LemmyError("no_post_edit_allowed"),
  );
});

test("Sticky a post", async () => {
  if (!betaCommunity) {
    throw "Missing beta community";
  }
  let postRes = await createPost(alpha, betaCommunity.community.id);

  let betaPost1 = await waitForPost(beta, postRes.post_view.post);
  if (!betaPost1) {
    throw "Missing beta post1";
  }
  let stickiedPostRes = await featurePost(beta, true, betaPost1.post);
  expect(stickiedPostRes.post_view.post.featured_community).toBe(true);

  // Make sure that post is stickied on beta
  let betaPost = await resolvePost(beta, postRes.post_view.post);
  expect(betaPost?.community.local).toBe(true);
  expect(betaPost?.creator.local).toBe(false);
  expect(betaPost?.post.featured_community).toBe(true);

  // Unsticky a post
  let unstickiedPost = await featurePost(beta, false, betaPost1.post);
  expect(unstickiedPost.post_view.post.featured_community).toBe(false);

  // Make sure that post is unstickied on beta
  let betaPost2 = await resolvePost(beta, postRes.post_view.post);
  expect(betaPost2?.community.local).toBe(true);
  expect(betaPost2?.creator.local).toBe(false);
  expect(betaPost2?.post.featured_community).toBe(false);

  // Make sure that gamma cannot sticky the post on beta
  let gammaPost = await resolvePost(gamma, postRes.post_view.post);
  if (!gammaPost) {
    throw "Missing gamma post";
  }
  // This has been failing occasionally
  await featurePost(gamma, true, gammaPost.post);
  let betaPost3 = await resolvePost(beta, postRes.post_view.post);
  // expect(gammaTrySticky.post_view.post.featured_community).toBe(true);
  expect(betaPost3?.post.featured_community).toBe(false);
});

test("Collection of featured posts gets federated", async () => {
  // create a new community and feature a post
  let community = await createCommunity(alpha);
  let post = await createPost(alpha, community.community_view.community.id);
  let featuredPost = await featurePost(alpha, true, post.post_view.post);
  expect(featuredPost.post_view.post.featured_community).toBe(true);

  // fetch the community, ensure that post is also fetched and marked as featured
  let betaCommunity = await resolveCommunity(
    beta,
    community.community_view.community.ap_id,
  );
  expect(betaCommunity).toBeDefined();

  const betaPost = await waitForPost(
    beta,
    post.post_view.post,
    post => post?.post.featured_community === true,
  );
  expect(betaPost).toBeDefined();
});

test("Lock a post", async () => {
  if (!betaCommunity) {
    throw "Missing beta community";
  }
  await followCommunity(alpha, true, betaCommunity.community.id);
  await waitUntil(
    () => resolveBetaCommunity(alpha),
    c => c?.community_actions?.follow_state == "Accepted",
  );

  let postRes = await createPost(alpha, betaCommunity.community.id);
  let betaPost1 = await waitForPost(beta, postRes.post_view.post);
  // Lock the post
  let lockedPostRes = await lockPost(beta, true, betaPost1.post);
  expect(lockedPostRes.post_view.post.locked).toBe(true);

  // Make sure that post is locked on alpha
  let alphaPost1 = await waitForPost(
    alpha,
    postRes.post_view.post,
    post => !!post && post.post.locked,
  );

  // Try to make a new comment there, on alpha. For this we need to create a normal
  // user account because admins/mods can comment in locked posts.
  let user = await registerUser(alpha, alphaUrl);
  await expect(createComment(user, alphaPost1.post.id)).rejects.toStrictEqual(
    new LemmyError("locked"),
  );

  // Unlock a post
  let unlockedPost = await lockPost(beta, false, betaPost1.post);
  expect(unlockedPost.post_view.post.locked).toBe(false);

  // Make sure that post is unlocked on alpha
  let alphaPost2 = await waitForPost(
    alpha,
    postRes.post_view.post,
    post => !!post && !post.post.locked,
  );
  expect(alphaPost2.community.local).toBe(false);
  expect(alphaPost2.creator.local).toBe(true);
  expect(alphaPost2.post.locked).toBe(false);

  // Try to create a new comment, on alpha
  let commentAlpha = await createComment(user, alphaPost1.post.id);
  expect(commentAlpha).toBeDefined();
});

test("Delete a post", async () => {
  if (!betaCommunity) {
    throw "Missing beta community";
  }

  let postRes = await createPost(alpha, betaCommunity.community.id);
  expect(postRes.post_view.post).toBeDefined();
  await waitForPost(beta, postRes.post_view.post);

  let deletedPost = await deletePost(alpha, true, postRes.post_view.post);
  expect(deletedPost.post_view.post.deleted).toBe(true);
  expect(deletedPost.post_view.post.name).toBe(postRes.post_view.post.name);

  // Make sure lemmy beta sees post is deleted
  // This will be undefined because of the tombstone
  await waitForPost(
    beta,
    postRes.post_view.post,
    p => p?.post?.deleted || p == undefined,
  );

  // Undelete
  let undeletedPost = await deletePost(alpha, false, postRes.post_view.post);

  // Make sure lemmy beta sees post is undeleted
  let betaPost2 = await waitForPost(
    beta,
    postRes.post_view.post,
    p => !!p && !p.post.deleted,
  );

  if (!betaPost2) {
    throw "Missing beta post 2";
  }
  expect(betaPost2.post.deleted).toBe(false);
  await assertPostFederation(betaPost2, undeletedPost.post_view);

  // Make sure lemmy beta cannot delete the post
  await expect(deletePost(beta, true, betaPost2.post)).rejects.toStrictEqual(
    new LemmyError("couldnt_update"),
  );
});

test("Remove a post from admin and community on different instance", async () => {
  if (!betaCommunity) {
    throw "Missing beta community";
  }

  let gammaCommunity = (
    await resolveCommunity(gamma, betaCommunity.community.ap_id)
  )?.community;
  if (!gammaCommunity) {
    throw "Missing gamma community";
  }
  let postRes = await createPost(gamma, gammaCommunity.id);

  let alphaPost = await resolvePost(alpha, postRes.post_view.post);
  if (!alphaPost) {
    throw "Missing alpha post";
  }
  let removedPost = await removePost(alpha, true, alphaPost.post);
  expect(removedPost.post_view.post.removed).toBe(true);
  expect(removedPost.post_view.post.name).toBe(postRes.post_view.post.name);

  // Make sure lemmy beta sees post is NOT removed
  let betaPost = await resolvePost(beta, postRes.post_view.post);
  if (!betaPost) {
    throw "Missing beta post";
  }
  expect(betaPost.post.removed).toBe(false);

  // Undelete
  let undeletedPost = await removePost(alpha, false, alphaPost.post);
  expect(undeletedPost.post_view.post.removed).toBe(false);

  // Make sure lemmy beta sees post is undeleted
  let betaPost2 = await resolvePost(beta, postRes.post_view.post);
  expect(betaPost2?.post.removed).toBe(false);
  await assertPostFederation(betaPost2!, undeletedPost.post_view);
});

test("Remove a post from admin and community on same instance", async () => {
  if (!betaCommunity) {
    throw "Missing beta community";
  }
  await followBeta(alpha);
  let gammaCommunity = await resolveCommunity(
    gamma,
    betaCommunity.community.ap_id,
  );
  let postRes = await createPost(gamma, gammaCommunity!.community.id);
  expect(postRes.post_view.post).toBeDefined();
  // Get the id for beta
  let betaPost = await waitForPost(beta, postRes.post_view.post);
  expect(betaPost).toBeDefined();

  let alphaPost0 = await waitForPost(alpha, postRes.post_view.post);
  expect(alphaPost0).toBeDefined();

  // The beta admin removes it (the community lives on beta)
  let removePostRes = await removePost(beta, true, betaPost.post);
  expect(removePostRes.post_view.post.removed).toBe(true);

  // Make sure lemmy alpha sees post is removed
  let alphaPost = await waitUntil(
    () => getPost(alpha, alphaPost0.post.id),
    p => p?.post_view.post.removed ?? false,
  );
  expect(alphaPost?.post_view.post.removed).toBe(true);
  await assertPostFederation(
    alphaPost.post_view,
    removePostRes.post_view,
    false,
  );

  // Undelete
  let undeletedPost = await removePost(beta, false, betaPost.post);
  expect(undeletedPost.post_view.post.removed).toBe(false);

  // Make sure lemmy alpha sees post is undeleted
  let alphaPost2 = await waitForPost(
    alpha,
    postRes.post_view.post,
    p => !!p && !p.post.removed,
  );
  expect(alphaPost2.post.removed).toBe(false);
  await assertPostFederation(alphaPost2, undeletedPost.post_view);
  await unfollowRemotes(alpha);
});

test("Search for a post", async () => {
  if (!betaCommunity) {
    throw "Missing beta community";
  }
  await unfollowRemotes(alpha);
  let postRes = await createPost(alpha, betaCommunity.community.id);
  expect(postRes.post_view.post).toBeDefined();

  let betaPost = await waitForPost(beta, postRes.post_view.post);
  expect(betaPost?.post.name).toBeDefined();
});

test("Enforce site ban federation for local user", async () => {
  if (!betaCommunity) {
    throw "Missing beta community";
  }

  // create a test user
  let alphaUserHttp = await registerUser(alpha, alphaUrl);
  let alphaUserPerson = (await getMyUser(alphaUserHttp)).local_user_view.person;
  let alphaUserActorId = alphaUserPerson?.ap_id;
  if (!alphaUserActorId) {
    throw "Missing alpha user actor id";
  }
  expect(alphaUserActorId).toBeDefined();
  await followBeta(alphaUserHttp);

  let alphaPerson = await resolvePerson(alphaUserHttp, alphaUserActorId!);
  if (!alphaPerson) {
    throw "Missing alpha person";
  }
  expect(alphaPerson).toBeDefined();

  // alpha makes post in beta community, it federates to beta instance
  let postRes1 = await createPost(alphaUserHttp, betaCommunity.community.id);
  let searchBeta1 = await waitForPost(beta, postRes1.post_view.post);

  // ban alpha from its own instance
  let banAlpha = await banPersonFromSite(
    alpha,
    alphaPerson.person.id,
    true,
    true,
  );
  expect(banAlpha.banned).toBe(true);

  // alpha ban should be federated to beta
  let alphaUserOnBeta1 = await waitUntil(
    () => resolvePerson(beta, alphaUserActorId!),
    res => res?.creator_banned == true,
  );
  expect(alphaUserOnBeta1?.creator_banned).toBe(true);

  // existing alpha post should be removed on beta
  let betaBanRes = await waitUntil(
    () => getPost(beta, searchBeta1.post.id),
    s => s.post_view.post.removed,
  );
  expect(betaBanRes.post_view.post.removed).toBe(true);

  // Unban alpha
  let unBanAlpha = await banPersonFromSite(
    alpha,
    alphaPerson.person.id,
    false,
    true,
  );
  expect(unBanAlpha.banned).toBe(false);

  // existing alpha post should be restored on beta
  betaBanRes = await waitUntil(
    () => getPost(beta, searchBeta1.post.id),
    s => !s.post_view.post.removed,
  );
  expect(betaBanRes.post_view.post.removed).toBe(false);

  // Login gets invalidated by ban, need to login again
  if (!alphaUserPerson) {
    throw "Missing alpha person";
  }
  let newAlphaUserJwt = await loginUser(alpha, alphaUserPerson.name);
  alphaUserHttp.setHeaders({
    Authorization: "Bearer " + newAlphaUserJwt.jwt,
  });
  // alpha makes new post in beta community, it federates
  let postRes2 = await createPost(alphaUserHttp, betaCommunity!.community.id);
  await waitForPost(beta, postRes2.post_view.post);

  await unfollowRemotes(alpha);
});

test("Enforce site ban federation for federated user", async () => {
  if (!betaCommunity) {
    throw "Missing beta community";
  }

  // create a test user
  let alphaUserHttp = await registerUser(alpha, alphaUrl);
  let alphaUserPerson = (await getMyUser(alphaUserHttp)).local_user_view.person;
  let alphaUserActorId = alphaUserPerson?.ap_id;
  if (!alphaUserActorId) {
    throw "Missing alpha user actor id";
  }
  expect(alphaUserActorId).toBeDefined();
  await followBeta(alphaUserHttp);

  let alphaUserOnBeta2 = await resolvePerson(beta, alphaUserActorId!);
  expect(alphaUserOnBeta2?.creator_banned).toBe(false);

  if (!alphaUserOnBeta2?.person) {
    throw "Missing alpha person";
  }

  // alpha makes post in beta community, it federates to beta instance
  let postRes1 = await createPost(alphaUserHttp, betaCommunity.community.id);
  let searchBeta1 = await waitForPost(beta, postRes1.post_view.post);
  expect(searchBeta1.post).toBeDefined();

  // Now ban and remove their data from beta
  let banAlphaOnBeta = await banPersonFromSite(
    beta,
    alphaUserOnBeta2.person.id,
    true,
    true,
  );
  expect(banAlphaOnBeta.banned).toBe(true);

  // existing alpha post should be removed on beta
  let betaRemovedPost = await getPost(beta, searchBeta1.post.id);
  expect(betaRemovedPost.post_view.post.removed).toBe(true);

  // post should also be removed on alpha
  let alphaRemovedPost = await waitUntil(
    () => getPost(alpha, postRes1.post_view.post.id),
    s => s.post_view.post.removed,
  );
  expect(alphaRemovedPost.post_view.post.removed).toBe(true);

  // User should not be shown to be banned from alpha
  let alphaPerson2 = (await getMyUser(alphaUserHttp)).local_user_view;
  expect(alphaPerson2.banned).toBe(false);

  // post to beta community is rejected
  await expect(
    createPost(alphaUserHttp, betaCommunity.community.id),
  ).rejects.toStrictEqual(new LemmyError("site_ban"));

  await unfollowRemotes(alpha);
});

test("Enforce community ban for federated user", async () => {
  if (!betaCommunity) {
    throw "Missing beta community";
  }
  await followBeta(alpha);
  let alphaShortname = `@lemmy_alpha@lemmy-alpha:8541`;
  let alphaPerson = await resolvePerson(beta, alphaShortname);
  if (!alphaPerson) {
    throw "Missing alpha person";
  }
  expect(alphaPerson).toBeDefined();

  // make a post in beta, it goes through
  let postRes1 = await createPost(alpha, betaCommunity.community.id);
  let searchBeta1 = await waitForPost(beta, postRes1.post_view.post);
  expect(searchBeta1.post).toBeDefined();

  // ban alpha from beta community
  let banAlpha = await banPersonFromCommunity(
    beta,
    alphaPerson.person.id,
    searchBeta1.community.id,
    true,
    true,
  );
  expect(banAlpha.banned).toBe(true);

  // ensure that the post by alpha got removed
  let removePostRes = await waitUntil(
    () => getPost(alpha, postRes1.post_view.post.id),
    s => s.post_view.post.removed,
  );
  expect(removePostRes.post_view.post.removed).toBe(true);
  expect(removePostRes.post_view.creator_banned_from_community).toBe(true);
  expect(
    removePostRes.community_view.community_actions?.received_ban_at,
  ).toBeDefined();

  // Alpha tries to make post on beta, but it fails because of ban
  await expect(
    createPost(alpha, betaCommunity.community.id),
  ).rejects.toStrictEqual(new LemmyError("person_is_banned_from_community"));

  // Unban alpha
  let unBanAlpha = await banPersonFromCommunity(
    beta,
    alphaPerson.person.id,
    searchBeta1.community.id,
    false,
    false,
  );
  expect(unBanAlpha.banned).toBe(false);

  // Check that unban was federated to alpha
  await waitUntil(
    () => getModlog(alpha),
    m =>
      m.modlog[0].type_ == "ModBanFromCommunity" &&
      m.modlog[0].mod_ban_from_community.banned == false,
  );

  let postRes3 = await createPost(alpha, betaCommunity.community.id);
  expect(postRes3.post_view.post).toBeDefined();
  expect(postRes3.post_view.community.local).toBe(false);
  expect(postRes3.post_view.creator.local).toBe(true);
  expect(postRes3.post_view.post.score).toBe(1);

  // Make sure that post makes it to beta community
  let postRes4 = await waitForPost(beta, postRes3.post_view.post);
  expect(postRes4.post).toBeDefined();
  expect(postRes4.creator_banned).toBe(false);

  await unfollowRemotes(alpha);
});

test("A and G subscribe to B (center) A posts, it gets announced to G", async () => {
  if (!betaCommunity) {
    throw "Missing beta community";
  }
  await followBeta(alpha);

  let postRes = await createPost(alpha, betaCommunity.community.id);
  expect(postRes.post_view.post).toBeDefined();

  let betaPost = await resolvePost(gamma, postRes.post_view.post);
  expect(betaPost?.post.name).toBeDefined();
  await unfollowRemotes(alpha);
});

test("Report a post", async () => {
  // Create post from alpha
  let alphaCommunity = await resolveBetaCommunity(alpha);
  await followBeta(alpha);
  let alphaPost = await createPost(alpha, alphaCommunity!.community.id);
  expect(alphaPost.post_view.post).toBeDefined();

  // add remote mod on epsilon
  await followBeta(epsilon);

  let betaCommunity = await resolveBetaCommunity(beta);
  let epsilonUser = await resolvePerson(
    beta,
    "@lemmy_epsilon@lemmy-epsilon:8581",
  );
  let mod_params: AddModToCommunity = {
    community_id: betaCommunity!.community.id,
    person_id: epsilonUser!.person.id,
    added: true,
  };
  let res = await beta.addModToCommunity(mod_params);
  expect(res.moderators.length).toBe(2);

  // Send report from gamma
  let gammaPost = await resolvePost(gamma, alphaPost.post_view.post);
  let gammaReport = (
    await reportPost(gamma, gammaPost!.post.id, randomString(10))
  ).post_report_view.post_report;
  expect(gammaReport).toBeDefined();

  // Report was federated to community instance
  let betaReport = (
    (await waitUntil(
      () =>
        listReports(beta).then(p =>
          p.reports.find(r => {
            return checkPostReportName(r, gammaReport);
          }),
        ),
      res => !!res,
    ))! as PostReportView
  ).post_report;
  expect(betaReport).toBeDefined();
  expect(betaReport.resolved).toBe(false);
  expect(betaReport.original_post_name).toBe(gammaReport.original_post_name);
  //expect(betaReport.original_post_url).toBe(gammaReport.original_post_url);
  expect(betaReport.original_post_body).toBe(gammaReport.original_post_body);
  expect(betaReport.reason).toBe(gammaReport.reason);
  await unfollowRemotes(alpha);

  // Report was federated to poster's instance. Alpha is not a community mod and doesnt see
  // the report by default, so we need to pass show_mod_reports = true.
  let alphaReport = (
    (await waitUntil(
      () =>
        listReports(alpha, true).then(p =>
          p.reports.find(r => {
            return checkPostReportName(r, gammaReport);
          }),
        ),
      res => !!res,
    ))! as PostReportView
  ).post_report;
  expect(alphaReport).toBeDefined();
  expect(alphaReport.resolved).toBe(false);
  expect(alphaReport.original_post_name).toBe(gammaReport.original_post_name);
  //expect(alphaReport.original_post_url).toBe(gammaReport.original_post_url);
  expect(alphaReport.original_post_body).toBe(gammaReport.original_post_body);
  expect(alphaReport.reason).toBe(gammaReport.reason);

  // Report was federated to remote mod instance
  let epsilonReport = (
    (await waitUntil(
      () =>
        listReports(epsilon).then(p =>
          p.reports.find(r => {
            return checkPostReportName(r, gammaReport);
          }),
        ),
      res => !!res,
    ))! as PostReportView
  ).post_report;
  expect(epsilonReport).toBeDefined();
  expect(epsilonReport.resolved).toBe(false);
  expect(epsilonReport.original_post_name).toBe(gammaReport.original_post_name);

  // Resolve report as remote mod
  let resolve_params: ResolvePostReport = {
    report_id: epsilonReport.id,
    resolved: true,
  };
  let resolve = await epsilon.resolvePostReport(resolve_params);
  expect(resolve.post_report_view.post_report.resolved).toBeTruthy();

  // Report should be marked resolved on community instance
  let resolvedReport = (
    (await waitUntil(
      () =>
        listReports(beta).then(p =>
          p.reports.find(r => {
            return checkPostReportName(r, gammaReport) && !!r.resolver;
          }),
        ),
      res => !!res,
    ))! as PostReportView
  ).post_report;
  expect(resolvedReport).toBeDefined();
  expect(resolvedReport.resolved).toBe(true);
});

test("Fetch post via redirect", async () => {
  await followBeta(alpha);
  let alphaPost = await createPost(alpha, betaCommunity!.community.id);
  expect(alphaPost.post_view.post).toBeDefined();
  // Make sure that post is liked on beta
  const betaPost = await waitForPost(
    beta,
    alphaPost.post_view.post,
    res => res?.post.score === 1,
  );

  expect(betaPost).toBeDefined();
  expect(betaPost.post?.ap_id).toBe(alphaPost.post_view.post.ap_id);

  // Fetch post from url on beta instance instead of ap_id
  let q = `http://lemmy-beta:8551/post/${betaPost.post.id}`;
  let form: ResolveObject = {
    q,
  };
  let gammaPost = await gamma
    .resolveObject(form)
    .then(a => a.results.at(0))
    .then(a => (a?.type_ == "Post" ? a : undefined));

  expect(gammaPost).toBeDefined();
  expect(gammaPost?.post.ap_id).toBe(alphaPost.post_view.post.ap_id);
  await unfollowRemotes(alpha);
});

test("Block post that contains banned URL", async () => {
  let editSiteForm: EditSite = {
    blocked_urls: ["https://evil.com/"],
  };

  await epsilon.editSite(editSiteForm);

  await delay();

  if (!betaCommunity) {
    throw "Missing beta community";
  }

  expect(
    createPost(epsilon, betaCommunity.community.id, "https://evil.com"),
  ).rejects.toStrictEqual(new LemmyError("blocked_url"));

  // Later tests need this to be empty
  editSiteForm.blocked_urls = [];
  await epsilon.editSite(editSiteForm);
});

test("Fetch post with redirect", async () => {
  let alphaPost = await createPost(alpha, betaCommunity!.community.id);
  expect(alphaPost.post_view.post).toBeDefined();

  // beta fetches from alpha as usual
  let betaPost = await resolvePost(beta, alphaPost.post_view.post);
  expect(betaPost?.post).toBeDefined();

  // gamma fetches from beta, and gets redirected to alpha
  let gammaPost = await resolvePost(gamma, betaPost!.post);
  expect(gammaPost?.post).toBeDefined();

  // fetch remote object from local url, which redirects to the original url
  let form: ResolveObject = {
    q: `http://lemmy-gamma:8561/post/${gammaPost?.post.id}`,
  };
  let gammaPost2 = await gamma
    .resolveObject(form)
    .then(a => a.results.at(0))
    .then(a => (a?.type_ == "Post" ? a : undefined));

  expect(gammaPost2?.post).toBeDefined();
});

test("Mention beta from alpha post body", async () => {
  if (!betaCommunity) throw Error("no community");
  let mentionContent = "A test mention of @lemmy_beta@lemmy-beta:8551";

  const postOnAlphaRes = await createPost(
    alpha,
    betaCommunity.community.id,
    undefined,
    mentionContent,
  );

  expect(postOnAlphaRes.post_view.post.body).toBeDefined();
  expect(postOnAlphaRes.post_view.community.local).toBe(false);
  expect(postOnAlphaRes.post_view.creator.local).toBe(true);
  expect(postOnAlphaRes.post_view.post.score).toBe(1);

  // get beta's localized copy of the alpha post
  let betaPost = await waitForPost(beta, postOnAlphaRes.post_view.post);
  if (!betaPost) {
    throw "unable to locate post on beta";
  }
  expect(betaPost.post.ap_id).toBe(postOnAlphaRes.post_view.post.ap_id);
  expect(betaPost.post.name).toBe(postOnAlphaRes.post_view.post.name);
  await assertPostFederation(betaPost, postOnAlphaRes.post_view);

  let mentionsRes = await waitUntil(
    () => listNotifications(beta, "Mention"),
    m => !!m.notifications[0],
  );

  const firstMention = mentionsRes.notifications[0].data as PostView;
  expect(firstMention.post!.body).toBeDefined();
  expect(firstMention.community!.local).toBe(true);
  expect(firstMention.creator.local).toBe(false);
  expect(firstMention.post!.score).toBe(1);
});

test("Rewrite markdown links", async () => {
  const community = await resolveBetaCommunity(beta);

  // create a post
  let postRes1 = await createPost(beta, community!.community.id);

  // link to this post in markdown
  let postRes2 = await createPost(
    beta,
    community!.community.id,
    "https://example.com/",
    `[link](${postRes1.post_view.post.ap_id})`,
  );
  expect(postRes2.post_view.post).toBeDefined();

  // fetch both posts from another instance
  const alphaPost1 = await resolvePost(alpha, postRes1.post_view.post);
  const alphaPost2 = await resolvePost(alpha, postRes2.post_view.post);

  // remote markdown link is replaced with local link
  expect(alphaPost2?.post.body).toBe(
    `[link](http://lemmy-alpha:8541/post/${alphaPost1?.post.id})`,
  );
});

test("Don't allow NSFW posts on instances that disable it", async () => {
  // Disallow NSFW on gamma
  let editSiteForm: EditSite = {
    disallow_nsfw_content: true,
  };
  await gamma.editSite(editSiteForm);

  // Wait for cache on Gamma's LocalSite
  await delay(1_000);

  if (!betaCommunity) {
    throw "Missing beta community";
  }

  // Make a NSFW post
  let postRes = await createPost(beta, betaCommunity.community.id);
  let form: EditPost = {
    nsfw: true,
    post_id: postRes.post_view.post.id,
  };
  let updatePost = await beta.editPost(form);

  // Gamma reject resolving the post
  await expect(
    resolvePost(gamma, updatePost.post_view.post),
  ).rejects.toStrictEqual(new LemmyError("not_found"));

  // Local users can't create NSFW post on Gamma
  let gammaCommunity = await resolveCommunity(
    gamma,
    betaCommunity.community.ap_id,
  );
  if (!gammaCommunity) {
    throw "Missing gamma community";
  }
  let gammaPost = await createPost(gamma, gammaCommunity.community.id);
  let form2: EditPost = {
    nsfw: true,
    post_id: gammaPost.post_view.post.id,
  };
  await expect(gamma.editPost(form2)).rejects.toStrictEqual(
    new LemmyError("nsfw_not_allowed"),
  );
});

test("Plugin test", async () => {
  let community = await createCommunity(epsilon);
  let postRes1 = await createPost(
    epsilon,
    community.community_view.community.id,
    "https://example.com/",
    randomString(10),
    "Rust",
  );
  expect(postRes1.post_view.post.name).toBe("Go");

  await expect(
    createPost(
      epsilon,
      community.community_view.community.id,
      "https://example.com/",
      randomString(10),
      "Java",
    ),
  ).rejects.toStrictEqual(
    new LemmyError("plugin_error", "We dont talk about Java"),
  );
});

function checkPostReportName(rcv: ReportCombinedView, report: PostReport) {
  switch (rcv.type_) {
    case "Post":
      return rcv.post_report.original_post_name === report.original_post_name;
    default:
      return false;
  }
}
