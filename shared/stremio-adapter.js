/* Runtime contract: stremio-web 7030b128af43afddd05d906025ecd6d99743f554.
 * Only allowlisted scalar data leaves sample(); account keys and streams stay in the vendor session.
 */
(function(root){
  'use strict';
  class StremioAdapter {
    constructor(runtime){this.runtime=runtime;this.kept=null;}
    core(){const live=this.runtime.core||this.runtime.services?.core||this.runtime.__permanentCore;
      if(live?.getState&&live?.dispatch)this.kept=live;
      if(!this.kept)throw new Error('stremio_runtime_unavailable');return this.kept;}
    async identity(){const ctx=await this.core().getState('ctx');const auth=ctx?.profile?.auth;
      return typeof auth?.user?._id==='string'&&typeof auth?.key==='string'&&auth.key.length>0?auth.user._id:null;}
    async library(){const model=await this.core().getState('library');if(!Array.isArray(model?.catalog))throw new Error('library_contract_changed');
      return model.catalog.map(item=>({id:item._id,type:item.type,title:item.name,position:item.state?.timeOffset||0,
        duration:item.state?.duration||0,videoId:item.state?.video_id||null}));}
    async setLibrary(item,save){if(!/^tt\d{4,12}$/.test(item.id)||!['movie','series'].includes(item.type))throw new Error('invalid_media_identity');
      this.core().dispatch(save?{action:'AddToLibrary',args:{id:item.id,type:item.type,name:item.title,posterShape:'poster'}}:{action:'RemoveFromLibrary',args:item.id});}
    async addons(){const model=await this.core().getState('installed_addons');if(!Array.isArray(model?.catalog))throw new Error('addons_contract_changed');return model.catalog;}
    async signOut(){this.core().dispatch({action:'Ctx',args:{action:'Logout'}});}
    async sample(nativeProgress=null){
      const state=await this.core().getState('player');
      const meta=state?.metaItem?.type==='Ready'?state.metaItem.content:null;
      if(!meta||!/^tt\d{4,12}$/.test(meta.id))return null;
      const video=this.runtime.document?.querySelector('video');
      const position=nativeProgress?nativeProgress.position:video?.currentTime;
      const duration=nativeProgress?nativeProgress.duration:video?.duration;
      const paused=nativeProgress?nativeProgress.paused:!video||video.paused||video.readyState<3;
      if(!Number.isFinite(position)||!Number.isFinite(duration)||duration<=0)return null;
      const series=state.seriesInfo;
      return {external_id:meta.id,season:series?.season??null,episode:series?.episode??null,
        position:Math.max(0,position),duration,paused:Boolean(paused)};
    }
    async resource(manifest,resource,type,id,extra=''){
      const base=new URL(manifest);if(base.protocol!=='https:'||!['catalog','meta','stream','addon_catalog'].includes(resource))throw new Error('invalid_addon_resource');
      const url=base.href.replace(/manifest\.json(?:\?.*)?$/,'')+`${resource}/${encodeURIComponent(type)}/${encodeURIComponent(id)}${extra?'/'+extra:''}.json`;
      const response=await fetch(url,{signal:AbortSignal.timeout(8000)});if(!response.ok)throw new Error('addon_unavailable');return response.json();
    }
  }
  root.DXBIStremioAdapter=StremioAdapter;
})(typeof window==='undefined'?globalThis:window);
