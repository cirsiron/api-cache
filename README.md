## 浏览器端接口缓存方案

### 前言
前端的性能优化已经产生了各种各样的解决方案，比如通过webpack的懒加载，treeShaking,external等或者是通过cdn或gzip的，核心都是在通过时间与空间的转化来进行优化。
同时性能优化不存在所谓的银弹，需要根据具体的项目来进行取舍。
本篇提供另一个思路来进行优化，通过缓存不经常变动或对实时性要求不高的接口数据。
其一，通过减少服务器的请求，给服务器进行减压。
其二，通过跳过了ajax的请求，直接读取浏览器本地的数据，可以加快数据的获取，在一定程度上
提升页面的响应速度，优化页面的性能。

### 使用场景
  - 接口返回数据变动频率很小或实时性要求不高
  - 短时间内的接口连续请求（可自定义）

### 缓存的问题
  - 1. 有效性
  - 2. 存储方式
  - 3. 大小限制
  - 4. 存储时唯一性 对于用户
    - 如果用户切换账户，处理方案
  - 5. 接入方式
    - 如何最低成本，不影响原项目逻辑

### 解决方案
  - 1. 有效性
    - 添加过期时间 类似于cookie
    - 过期跳过已缓存数据，重新请求数据并进行覆盖
  - 2. 存储方式
    - 可选 (localStorage, sessionStorage) 默认sessionStorage
  - 3. 大小限制
    - 异常处理，走正常请求
  - 4. 存储时唯一性 对于用户
    - 如果用户切换账户，处理方案
      - 提供初始接口地址，匹配到初始接口清空原数据 
  - 5. 接入方式
    - 如何最低成本，不影响原项目逻辑
      - 拦截器方式

### 使用方式

  ```js
  import ApiCache from 'ApiCache'
  import axios from 'axios'

  const options = {
    ajax: axios.create(xxx),
    cacheUrlList: ['xxx']
  }
  new ApiCache(options).start()
  ```
#### 配置项 options
- ajax: Object (必填)
  - 被拦截的请求HTTP对象（支持axios，通过axios.create()创建）
- cacheUrlList: Array[]
  - 需要缓存的接口
- entryUrl:String
  - 接口初始化地址 用于清空以前的数据
- mode:String (默认session)
  - 存储模式
    - "local" 存储在localStorage
    - "session" 存储在sessionStorage
- expires: Number (默认10)
  - 过期时间 (分钟)

### 核心代码实现

#### 拦截axios的方法
```js
  this.interceptorGet(this.ajax)
  this.interceptorPost(this.ajax)

  // post拦截处理逻辑
  interceptorPost (axios) {
    // 缓存post
    const post = axios.post
    if (!post) {
      return
    }
    const that = this
    function postFn (post, url, params, resolve, reject) {
      const urlKey = `${url}${JSON.stringify(params || '')}`
      post(url, params).then((res) => {
        if (!that.map[urlKey] && that.cacheUrlList.includes(url)) {
          that.map[urlKey] = res
        }
        resolve(res)
      }, reject)
    }
    axios.post = function (url, params) {
      // 确定 缓存key值 没有将url来当作key，是由于同一个接口由于参数不同，返回的数据是不同的
      const urlKey = `${url}${JSON.stringify(params || '')}`
      if (!that.includeCacheUrl(url)) {
        return post(url, params)
      }
      const mapData = that.map[urlKey] || that.storageGet(urlKey).val
      if (mapData) {
        // 模拟axios返回Promise
        return new Promise(function (resolve, reject) {
          try {
            resolve(mapData)
          } catch (e) {
            // 解析失败
            console.log(e)
            postFn(post, url, params, resolve, reject)
          }
        })
      }
      that.defineMapDataToStorage(urlKey)
      return new Promise(function (resolve, reject) {
        postFn(post, url, params, resolve, reject)
      })
    }
  }
```

#### 浏览器的数据增删改查与过期处理
思路：通过Object.defineProperty劫持缓存的数据，在getter和setter上处理浏览器存取删数据和过期等处理的功能可减少代码逻辑
```js
    Object.defineProperty(this.map, key, {
      configurable: true,
      get () {
        // TODO: 是否需要开启计数
        // that.setCount(key)
        const data = that.storageGet(key)
        // 过期
        if (data.expire < Date.now()) {
          delete that.map.key
          that.expireCache(key)
          return null
        }
        return data.val
      },
      set (val) {
        // 初始入口需要清空历史数据
        if (that.entryUrl === key) {
          that.map = {}
          that.expires()
        }
        that.storageSet(key, {
          val,
          expire: Date.now() + that.expires
        })
      }
    })
```

#### 过期处理
- 模拟cookie的过期处理逻辑
```js
  // 添加expire过期字段，获取数据时，如果过期将做删除和更新处理
  this.storageSet(key, {
    val,
    expire: Date.now() + that.expires
  })
```
