import React, { useEffect, useState } from 'react';
import { connect } from 'react-redux';
import { Link } from 'react-router';
import { manageDatabasesRoute } from '../../Common/utils/routesUtils';
import TreeView from './TreeView';
import { getDatabaseTableTypeInfo } from './DataActions';
import { useDataSource } from '../../../dataSources';
import { isInconsistentSource } from './utils';
import { getSourceDriver } from './utils';
import { getDataSources } from '../../../metadata/selector';
import {
  updateCurrentSchema,
  UPDATE_CURRENT_DATA_SOURCE,
  fetchDataInit,
} from './DataActions';
import _push from './push';
import Button from '../../Common/Button/Button';
import styles from '../../Common/Layout/LeftSubSidebar/LeftSubSidebar.scss';
import Spinner from '../../Common/Spinner/Spinner';

const DATA_SIDEBAR_SET_LOADING = 'dataSidebar/DATA_SIDEBAR_SET_LOADING';

export const setSidebarLoading = isLoading => ({
  type: DATA_SIDEBAR_SET_LOADING,
  data: isLoading,
});

// initial state
const sidebarState = {
  loading: false,
};

/* Reducer */
export const dataSidebarReducer = (state = sidebarState, action) => {
  switch (action.type) {
    case DATA_SIDEBAR_SET_LOADING:
      return {
        ...state,
        loading: action.data,
      };
    default:
      return state;
  }
};

const groupByKey = (list, key) =>
  list.reduce(
    (hash, obj) => ({
      ...hash,
      [obj[key]]: (hash[obj[key]] || []).concat(obj),
    }),
    {}
  );

const DataSubSidebar = props => {
  const {
    migrationMode,
    dispatch,
    tables,
    functions,
    sources,
    currentDataSource,
    schemaList,
    currentSchema,
    enums,
    inconsistentObjects,
    pathname,
    dataSources,
    sidebarLoadingState,
  } = props;
  const { setDriver } = useDataSource();

  const [databaseLoading, setDatabaseLoading] = useState(false);
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [preLoadState, setPreLoadState] = useState(true);

  const onDatabaseChange = newSourceName => {
    if (newSourceName === currentDataSource) {
      dispatch(_push(`/data/${newSourceName}/`));
      return;
    }
    setDatabaseLoading(true);
    const driver = getSourceDriver(dataSources, newSourceName);
    dispatch({
      type: UPDATE_CURRENT_DATA_SOURCE,
      source: newSourceName,
    });
    setDriver(driver);
    dispatch(_push(`/data/${newSourceName}/`));
    dispatch(fetchDataInit()).finally(() => {
      setDatabaseLoading(false);
    });
  };

  const onSchemaChange = value => {
    if (value === currentSchema) {
      dispatch(_push(`/data/${currentDataSource}/schema/${value}`));
      return;
    }

    setSchemaLoading(true);
    dispatch(updateCurrentSchema(value, currentDataSource))
      .then(() => {
        dispatch(_push(`/data/${currentDataSource}/schema/${value}`));
      })
      .finally(() => {
        setSchemaLoading(false);
      });
  };

  const getItems = (schemaInfo = null) => {
    let sourceItems = [];
    sources.forEach(source => {
      if (isInconsistentSource(source.name, inconsistentObjects)) return;

      const sourceItem = { name: source.name, type: 'database' };
      const sourceTables = !source.tables
        ? []
        : source.tables.map(data => {
            const is_enum = data.is_enum ? true : false;
            return {
              name: data.table.name,
              schema: data.table.schema,
              type: 'table',
              is_enum: is_enum,
            };
          });
      const sourceFunctions = !source.functions
        ? []
        : source.functions.map(data => ({
            name: data.function.name,
            schema: data.function.schema,
            type: 'function',
          }));

      const schemaGroups = groupByKey(
        [...sourceTables, ...sourceFunctions],
        'schema'
      );

      // Find out the difference between schemas from metadata and SchemaList from state
      const schemasFromMetadata = Array.from(
        new Set([
          ...sourceTables.map(i => i.schema),
          ...sourceFunctions.map(i => i.schema),
        ])
      );
      const missingSchemas = schemaList.filter(
        x => !schemasFromMetadata.includes(x)
      );

      let schemaItems = [];
      Object.keys(schemaGroups).forEach(schema => {
        const schemaItem = { name: schema, type: 'schema' };
        const tableItems = [];
        schemaGroups[schema].forEach(table => {
          const is_view =
            schemaInfo &&
            schemaInfo[source.name][schema] &&
            schemaInfo[source.name][schema][table.name]
              ? schemaInfo[source.name][schema][table.name].table_type ===
                  'view' ||
                schemaInfo[source.name][schema][table.name].table_type ===
                  'materialized_view'
              : false;
          let type = table.type;
          if (is_view) type = 'view';
          if (table.is_enum) type = 'enum';
          tableItems.push({
            name: table.name,
            type: type,
          });
        });
        schemaItem.children = tableItems;
        schemaItems = [...schemaItems, schemaItem];
      });

      sourceItem.children = schemaItems;

      if (source.name === currentDataSource) {
        sourceItem.children = [
          ...missingSchemas.map(schemaName => ({
            name: schemaName,
            type: 'schema',
            children: [],
          })),
          ...sourceItem.children,
        ];
      }

      sourceItems = [...sourceItems, sourceItem];
    });
    return sourceItems;
  };

  const [treeViewItems, setTreeViewItems] = useState([]);

  const updateTreeViewItemsWithSchemaInfo = () => {
    const schemaPromises = [];
    sources.forEach(source => {
      const currentSourceTables = sources
        .filter(i => i.name === source.name)[0]
        .tables.map(i => `'${i.table.name}'`);
      schemaPromises.push(
        dispatch(
          getDatabaseTableTypeInfo(
            source.kind,
            source.name,
            currentSourceTables
          )
        ).then(data => ({ source: source.name, schemaInfo: data }))
      );
    });
    Promise.all(schemaPromises).then(data => {
      const schemaInfo = {};
      data.forEach(item => {
        schemaInfo[item.source] = item.schemaInfo;
      });
      const newItems = getItems(schemaInfo);
      setTreeViewItems(newItems);
      setIsFetching(false);
      setPreLoadState(false);
    });
  };

  useEffect(() => {
    setIsFetching(true);
    updateTreeViewItemsWithSchemaInfo();
  }, [
    sources.length,
    tables,
    functions,
    enums,
    schemaList,
    dataSources, // trigger rerender on table name change
    inconsistentObjects,
  ]);

  const loadStyle = {
    pointerEvents: 'none',
    cursor: 'progress',
  };

  const databasesCount = treeViewItems?.length || 0;

  return (
    <div className={`${styles.subSidebarList} ${styles.padd_top_small}`}>
      <div className={styles.sidebarHeadingWrapper}>
        <div
          className={`col-xs-8 ${styles.sidebarHeading} ${styles.padd_left_remove}`}
        >
          <div
            className={`${styles.padd_top_small} ${styles.inline_display} ${styles.display_flex} ${styles.align_items_center}`}
          >
            <div>Databases ({databasesCount})</div>
            {schemaLoading ||
            databaseLoading ||
            sidebarLoadingState ||
            isFetching ? (
              <div className={styles.inline_display}>
                <Spinner className={styles.spinner} />
              </div>
            ) : (
              <i
                className={`fa fa-check-circle ${styles.padd_left_sm} ${styles.color_green}`}
                aria-hidden="true"
              />
            )}
          </div>
        </div>
        {migrationMode && (
          <div
            className={`col-xs-4 text-center ${styles.padd_left_remove} ${styles.sidebarCreateTable}`}
          >
            <Link className={styles.padd_remove_full} to={manageDatabasesRoute}>
              <Button
                size="xs"
                color="white"
                data-test="sidebar-manage-database"
              >
                Manage
              </Button>
            </Link>
          </div>
        )}
      </div>
      <ul className={styles.subSidebarListUL} data-test="table-links">
        <div
          style={
            schemaLoading ||
            databaseLoading ||
            sidebarLoadingState ||
            isFetching
              ? loadStyle
              : { pointerEvents: 'auto' }
          }
        >
          <TreeView
            items={treeViewItems}
            onDatabaseChange={onDatabaseChange}
            onSchemaChange={onSchemaChange}
            currentDataSource={currentDataSource}
            currentSchema={currentSchema}
            pathname={pathname}
            databaseLoading={databaseLoading}
            preLoadState={preLoadState}
          />
        </div>
      </ul>
    </div>
  );
};

const mapStateToProps = state => {
  return {
    migrationMode: state.main.migrationMode,
    sources: state.metadata.metadataObject.sources,
    inconsistentObjects: state.metadata.inconsistentObjects,
    tables: state.metadata.metadataObject.sources.map(s => s.tables).flat()
      .length,
    enums: state.metadata.metadataObject.sources
      .map(s => s.tables)
      .flat()
      .filter(item => item.hasOwnProperty('is_enum')).length,
    functions: state.metadata.metadataObject.sources
      .map(s => s.functions || [])
      .flat().length,
    currentDataSource: state.tables.currentDataSource,
    currentSchema: state.tables.currentSchema,
    schemaList: state.tables.schemaList,
    pathname: state?.routing?.locationBeforeTransitions?.pathname,
    dataSources: getDataSources(state),
    sidebarLoadingState: state.dataSidebar.loading,
  };
};

export default connect(mapStateToProps)(DataSubSidebar);
