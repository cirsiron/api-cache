// 接口缓存方案
// 使用场景
// - 数据不经常变动的接口
/**
 * 功能：
 * 1. 提供过期失效，时间戳与过期逻辑
 *  - 有效期内使用
 *  - 过期重新请求数据，并覆盖原缓存数据
 * 2. localStorage缓存，大小限制的处理方法，超过大小会报异常,并跳过不会影响正常请求逻辑
 * 3. 如果切换账号的话，能够失效
 * 4. 获取本地异常时，可以正常发起请求
 * 5. 劫持axios数据处理，方便接入
 * 6. TODO: 支持匹配url缓存接口数据
 * 7. TODO: 内存过大部分数据清除，清除逻辑，增加读取频率，频率较低的先删除
 */

// storage存储
const storage = {
  local: {
    get (key) {
      try {
        return JSON.parse(localStorage.getItem(key))
      } catch (e) {
        console.log(e)
        return null
      }
    },
    set (key, value) {
      try {
        let val = value
        if (!(typeof value === 'string')) {
          val = JSON.stringify(value)
        }
        localStorage.setItem(key, val)
      } catch (e) {
        if (/exceeded/g.test(e)) {
          console.log('存储内容溢出')
          return
        }
        console.log(e)
      }
    },
    remove (keys) {
      if (Array.isArray(keys)) {
        keys.forEach((key) => {
          localStorage.removeItem(key)
        })
        return
      }
      localStorage.removeItem(keys)
    },
    clear () {
      localStorage.clear()
    }
  },
  session: {
    get (key) {
      try {
        return JSON.parse(sessionStorage.getItem(key))
      } catch (e) {
        console.log(e)
        return null
      }
    },
    set (key, value) {
      try {
        let val = value
        if (!(typeof value === 'string')) {
          val = JSON.stringify(value)
        }
        sessionStorage.setItem(key, val)
      } catch (e) {
        console.log(e)
      }
    },
    remove (keys) {
      if (Array.isArray(keys)) {
        keys.forEach((key) => {
          sessionStorage.removeItem(key)
        })
        return
      }
      sessionStorage.removeItem(keys)
    },
    clear () {
      sessionStorage.clear()
    }
  }
}
// 快排 用于溢出时将使用频率低的api删除
// function quickSort (arr) {
//   if (!Array.isArray(arr)) {
//     return []
//   }
//   if (arr.length <= 1) {
//     return arr
//   }
//   // 基准索引
//   const pivotIndex = Math.floor(arr.length / 2)
//   const pivot = arr.splice(pivotIndex, 1)[0]
//   const left = []
//   const right = []
//   arr.forEach((item) => {
//     if (item < pivot) {
//       left.push(item)
//     } else {
//       right.push(item)
//     }
//   })
//   return quickSort(left).concat(pivot, quickSort(right))
// }

class ApiCache {
  constructor (options) {
    const { mode, expires, cacheUrlList = [], entryInitUrl, ajax } = options || {}
    this.ajax = ajax
    // 需要缓存的接口,支持匹配规则
    // * => 全部
    // /xxx/* 以/xxx开头的接口; 
    // /xxx/xxx 精确匹配 
    this.cacheUrlList = cacheUrlList
    // 接口初始化地址 用于清空前一个账号数据
    this.entryUrl = entryInitUrl
    // 存储模式
    this.mode = ['session', 'local'].includes(mode) ? mode : 'session'
    // 接口数据过期时间
    this.expires = typeof expires === 'number' ? 60 * expires * 1000 : 60 * 10 * 1000 // 默认10分钟
    // 缓存接口数据
    this.map = {}
    // 计算api对应的频率
    this.counts = {}
  }
  storageGet (key) {
    return storage[this.mode].get(key) || {
      val: null
    }
  }
  storageSet (key, val) {
    storage[this.mode].set(key, val)
  }
  storageRemove (keys) {
    storage[this.mode].remove(keys)
  }
  // 计算接口访问频率
  setCount (key) {
    if (this.counts[key] === undefined) {
      this.counts[key] = 0
    }
    this.counts[key]++
    console.log(this.counts)
  }
  // 绑定单个值
  definePropertyMap (key) {
    const that = this
    if (this.map[key]) {
      return
    }
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
          that.expireAll()
        }
        that.storageSet(key, {
          val,
          expire: Date.now() + that.expires
        })
      }
    })
  }
  defineMapDataToStorage (keys) {
    if (typeof keys === 'string') {
      this.definePropertyMap(keys)
      return
    }
    if (Object.prototype.toString.call(keys) === '[object Object]') {
      for (let key of keys) {
        this.definePropertyMap(key)
      }
    }
  }
  // 过期/失效处理
  expireCache (key) {
    this.storageRemove(key)
  }
  // 清空全部数据
  expireAll () {
    this.storageRemove(this.cacheUrlList)
  }
  // TODO: 缓存超过限制处理机制
  exceedCache () {
  }
  includeCacheUrl (url) {
    return this.cacheUrlList.includes(url)
  }
  // 拦截get
  interceptorGet (axios) {
    const get = axios.get
    if (!get) {
      return get
    }
    const that = this
    function getFn (get, url, params, resolve, reject) {
      const urlKey = `${url}${JSON.stringify(params || '')}`
      get(url, params).then((res) => {
        if (!that.map[urlKey]) {
          that.map[urlKey] = res
        }
        resolve(res)
      }, reject)
    }
    axios.get = function (url, params) {
      if (!that.includeCacheUrl(url) && that.cacheUrlList.includes(url)) {
        return get(url, params)
      }
      const urlKey = `${url}${JSON.stringify(params || '')}`
      const mapData = that.map[urlKey] || that.storageGet(urlKey).val
      if (mapData) {
        return new Promise(function (resolve, reject) {
          try {
            resolve(mapData)
          } catch (e) {
            getFn(get, url, params, resolve, reject)
          }
        })
      }
      that.defineMapDataToStorage(urlKey)
      return new Promise((resolve, reject) => {
        getFn(get, url, params, resolve, reject)
      })
    }
  }
  // 拦截post
  interceptorPost (axios) {
    const post = axios.post
    if (!post) {
      return axios
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
      const urlKey = `${url}${JSON.stringify(params || '')}`
      if (!that.includeCacheUrl(url)) {
        return post(url, params)
      }
      const mapData = that.map[urlKey] || that.storageGet(urlKey).val
      if (mapData) {
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
  start () {
    this.interceptorGet(this.ajax)
    this.interceptorPost(this.ajax)
    return this.ajax
  }
}

export default ApiCache
