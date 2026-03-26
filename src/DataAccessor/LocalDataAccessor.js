import DataAccessor from './Base/DataAccessor';
 
class LocalDataAccessor extends DataAccessor {
 
  async fetchData( jsonFilePath ) {
    const response = await fetch( jsonFilePath );
   
    if (!response.ok){
      throw new Error( jsonFilePath + ' 読み込み失敗');
    }
   
    const data = await response.json();
    console.log( jsonFilePath + 'データ取得完了');
    return data;
  }
 
  async fetchCityJsonData() {
    // return this.fetchData( '/251211_Polyhedron_test 1.json' );
    // return this.fetchData( '/Cityjson_sample_hikifune.json' );
    return this.fetchData( '/Cityjson_sample.json' );
    // return this.fetchData( '/Cityjson_sample_develop.json' );
    // return this.fetchData( '/pipe_extrusion_251219_01_interval_3p0.json' );
  }
 
  async fetchCityJsonElevationData() {
    return this.fetchData( '/pipe_extrusion_251219_01_interval_3p0.json' );
  }
 
  async updateCityJsonData( updatedObjectData ) {
    console.log('スタンドアロンモードでは、オブジェクト更新には対応していません。');
  }
 
  async addCityJsonData( newObjectData ) {
    console.log('スタンドアロンモードでは、オブジェクト追加には対応していません。');
  }
 
  async fetchShapeTypesData() {
    return this.fetchData( '/shape_types.json' );
  }
 
  async fetchShapeTypesElevationData() {
    return this.fetchData( '/shape_types.json' );
  }
 
  async fetchSourceTypesData() {
    return this.fetchData( '/source_types.json' );
  }
 
  async fetchSourceTypesElevationData() {
    return this.fetchData( '/source_types.json' );
  }
 
  async fetchUserPositionDataList() {
    // return this.fetchData( '/user_pos_1.json' );
    return this.fetchData( '/user_pos_develop.json' );
  }
 
  async fetchUserPositionElevationDataList() {
    return this.fetchData( '/user_pos_develop.json' );
  }
 
  async fetchUserPositionData( userId ) {
    // return this.fetchData( '/user_pos_1.json' );
    const jsonData = await this.fetchData( '/user_pos_develop.json' )
    return jsonData[0];
  }
 
  async updateRegionUserPositionData( userId, regionPos, height, roll, pitch, yaw ) {
    console.log("スタンドアロンモードでは、位置更新に対応していません。");
  }
 
  async updateGlobalUserPositionData( userId, globalPos ) {
    console.log("スタンドアロンモードでは、位置更新に対応していません。");
  }
 
  async initializeLayerPanelData() {
  }
 
  async fetchLayerPanelData() {
    // return this.fetchData( '/layer_panel_hikifune.json' );
    // return this.fetchData( '/layer_panel_develop.json' );
    return this.fetchData( '/layer_panel.json' );
    // return this.fetchData( '/layer_panel_tora.json' );
  }
 
  async fetchLayerPanelElevationData() {
    return this.fetchData( '/layer_panel_tora.json' );
  }
 
  async saveLayerPanelData(layers) {
    // ファイルダウンロード(デバッグ用)
    super.download_as_Json( layers, "layer_panel" );  
  }
 
  // SSE登録
  getEventSource( endPoint ) {
    // ダミーのEventSourceを返す
    return {
      onmessage: null,
      close: () => console.log("Mock EventSource closed"),
    };
  }
}
 
export default LocalDataAccessor;