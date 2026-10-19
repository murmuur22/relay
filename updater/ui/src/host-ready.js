import {stagedEligible} from './state.js';
import {reviewVersion} from './review.js';
// Presentation hints only. No authorization material or mutation crosses frames.
export function parseReadyMessage(data,type='relay-updater-observation'){
 if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).sort().join(',')!=='jobId,phase,type,version'||data.type!==type)return null;
 if(type==='relay-updater-observation'&&data.phase==='unavailable'&&data.jobId===''&&data.version==='')return data;
 if(typeof data.jobId!=='string'||data.jobId.length!==32||!/^[a-f0-9]{32}$/.test(data.jobId)||typeof data.version!=='string'||!data.version||reviewVersion(data.version)!==data.version)return null;
 if(type==='relay-updater-review' ? data.phase!=='ready' : !['ready','succeeded'].includes(data.phase))return null;
 return data;
}
export function readyObservation(state,fresh){
 const job=state?.job;
 if(!fresh||!job||typeof job.id!=='string'||job.id.length!==32||!/^[a-f0-9]{32}$/.test(job.id)||typeof job.version!=='string'||!job.version||reviewVersion(job.version)!==job.version)return {type:'relay-updater-observation',jobId:'',version:'',phase:'unavailable'};
 if(stagedEligible({state,fresh,authenticated:true,action:'apply',version:job.version,jobId:job.id}))return {type:'relay-updater-observation',jobId:job.id,version:job.version,phase:'ready'};
 if(job.phase==='succeeded'&&state.currentVersion===job.version)return {type:'relay-updater-observation',jobId:job.id,version:job.version,phase:'succeeded'};
 return {type:'relay-updater-observation',jobId:'',version:'',phase:'unavailable'};
}
